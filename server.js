const dgram = require("dgram");
const ip = require("ip"); // Used to convert IPv6 strings to buffers

const server = dgram.createSocket("udp4");

// In-memory DNS records (A, AAAA, CNAME, NS)
const records = {
  "example.com": [
    { type: "A", value: "1.2.3.4" },
    { type: "AAAA", value: "2001:db8::1" },
  ],
  "test.com": [{ type: "A", value: "5.6.7.8" }],
  "alias.com": [{ type: "CNAME", value: "example.com" }],
  "alias2.com": [{ type: "CNAME", value: "alias.com" }],
  "example.org": [{ type: "NS", value: "ns1.example.org" }],
  "example.net": [{ type: "NS", value: "ns1.example.net" }],
  "ns1.example.org": [{ type: "A", value: "9.9.9.9" }],
};

// --- UDP Server: Main message handler ---
server.on("message", (msg, rinfo) => {
  // Parse the 12-byte DNS header
  function parseHeader(buffer) {
    return {
      id: buffer.readUInt16BE(0),
      flags: buffer.readUInt16BE(2),
      qdCount: buffer.readUInt16BE(4),
      anCount: buffer.readUInt16BE(6),
      nsCount: buffer.readUInt16BE(8),
      arCount: buffer.readUInt16BE(10),
    };
  }

  // Parse the question section starting at byte 12
  function parseQuestion(buffer, offset) {
    let labels = [];
    let len = buffer[offset];
    let originalOffset = offset;

    while (len !== 0) {
      offset++;
      labels.push(buffer.toString("utf8", offset, offset + len));
      offset += len;
      len = buffer[offset];
    }

    const name = labels.join(".");
    offset++;
    const qtype = buffer.readUInt16BE(offset);
    offset += 2;
    const qclass = buffer.readUInt16BE(offset);
    offset += 2;

    return { name, type: qtype, class: qclass, nextOffset: offset };
  }

  console.log("Received message from", rinfo.address, rinfo.port);

  const header = parseHeader(msg);
  const question = parseQuestion(msg, 12);

  console.log("Parsed Header:", header);
  console.log("Parsed Question:", question);

  // ------------------ BUILD RESPONSE ------------------

  // Encode the DNS header for the response
  const buildDnsHeader = (
    id,
    isResponse = true,
    rcode = 0,
    answerCount = 1,
    nsCount = 0,
    arCount = 0
  ) => {
    const buffer = Buffer.alloc(12);
    buffer.writeUInt16BE(id, 0);
    let flags = 0;
    if (isResponse) flags |= 0x8000; // QR = response
    flags |= 0x0100; // RD
    flags |= 0x0080; // RA
    flags |= rcode & 0xf;
    buffer.writeUInt16BE(flags, 2);
    buffer.writeUInt16BE(1, 4); // QDCOUNT
    buffer.writeUInt16BE(rcode === 0 ? answerCount : 0, 6); // ANCOUNT
    buffer.writeUInt16BE(nsCount, 8); // NSCOUNT
    buffer.writeUInt16BE(arCount, 10); // ARCOUNT
    return buffer;
  };

  // Encode domain name into DNS label format
  const encodeName = (domain) => {
    return Buffer.concat(
      domain
        .split(".")
        .map((part) => {
          const len = Buffer.alloc(1);
          len.writeUInt8(part.length);
          return Buffer.concat([len, Buffer.from(part)]);
        })
        .concat(Buffer.from([0]))
    );
  };

  // Convert IPv6 string to buffer
  function ipv6ToBuffer(ipv6) {
    return Buffer.from(ip.toBuffer(ipv6));
  }

  // Build the question section
  const buildQuestion = (name, type = 1) => {
    const qname = encodeName(name);
    const qtype = Buffer.alloc(2);
    qtype.writeUInt16BE(type);
    const qclass = Buffer.alloc(2);
    qclass.writeUInt16BE(1); // IN
    return Buffer.concat([qname, qtype, qclass]);
  };

  // Build a single answer (A, AAAA, CNAME, NS)
  const buildAnswer = (name, record) => {
    const nameBuf = encodeName(name);
    const typeBuf = Buffer.alloc(2);
    const classBuf = Buffer.alloc(2);
    const ttlBuf = Buffer.alloc(4);
    let rdataBuf;
    let typeCode;

    switch (record.type) {
      case "A":
        typeCode = 1;
        rdataBuf = Buffer.from(record.value.split(".").map(Number));
        break;
      case "AAAA":
        typeCode = 28;
        rdataBuf = ipv6ToBuffer(record.value);
        break;
      case "CNAME":
        typeCode = 5;
        rdataBuf = encodeName(record.value);
        break;
      case "NS":
        typeCode = 2;
        rdataBuf = encodeName(record.value);
        break;
      default:
        return null;
    }

    typeBuf.writeUInt16BE(typeCode);
    classBuf.writeUInt16BE(1);
    ttlBuf.writeUInt32BE(300);

    const dataLenBuf = Buffer.alloc(2);
    dataLenBuf.writeUInt16BE(rdataBuf.length);

    return Buffer.concat([
      nameBuf,
      typeBuf,
      classBuf,
      ttlBuf,
      dataLenBuf,
      rdataBuf,
    ]);
  };

  // Resolve domain -> chain of records (follows CNAMEs recursively)
  function resolveChain(name, qtype) {
    let answers = [];
    let finalRecord = null;
    let currentName = name;
    let depth = 0;

    while (depth < 5) {
      const domainRecords = records[currentName];
      if (!domainRecords) break;

      // CNAME resolution
      const cnameRecord = domainRecords.find((r) => r.type === "CNAME");
      if (cnameRecord) {
        answers.push(buildAnswer(currentName, cnameRecord));
        currentName = cnameRecord.value;
        depth++;
        continue;
      }

      // Matching actual record
      const match = domainRecords.find(
        (r) => getTypeCode(r.type) === qtype || qtype === 255
      );
      if (match) {
        answers.push(buildAnswer(currentName, match));
        finalRecord = match;
        break;
      }

      break;
    }

    return { answers, finalRecord };
  }

  // Convert record type to numeric code
  function getTypeCode(type) {
    switch (type) {
      case "A":
        return 1;
      case "NS":
        return 2;
      case "CNAME":
        return 5;
      case "AAAA":
        return 28;
      default:
        return 0;
    }
  }

  // Build glue records if available (not used deeply here)
  function buildAdditionalRecords(nsRecords) {
    const additionals = [];

    nsRecords.forEach((nsRecord) => {
      const glueRecords = records[nsRecord.value];
      if (glueRecords && Array.isArray(glueRecords)) {
        glueRecords.forEach((r) => {
          if (r.type === "A") {
            const glueAnswer = buildAnswer(nsRecord.value, r);
            if (glueAnswer) {
              additionals.push(glueAnswer);
            }
          }
        });
      }
    });

    return additionals;
  }

  // --------- RESPONSE CONSTRUCTION LOGIC -----------

  const { answers: answerBufs, finalRecord } = resolveChain(
    question.name,
    question.type
  );
  let additionalBufs = [];

  if (answerBufs.length > 0) {
    // Add glue records for NS if needed
    if (finalRecord?.type === "NS") {
      additionalBufs = buildAdditionalRecords([finalRecord]);
    }

    // Final response: Header + Question + Answers + Additionals
    const responseHeader = buildDnsHeader(
      header.id,
      true,
      0,
      answerBufs.length,
      0,
      additionalBufs.length
    );
    const questionBuf = buildQuestion(question.name, question.type);
    const fullResponse = Buffer.concat([
      responseHeader,
      questionBuf,
      ...answerBufs,
      ...additionalBufs,
    ]);

    server.send(fullResponse, rinfo.port, rinfo.address);
    return;
  }

  // If record exists but doesn't match type (empty answer)
  if (finalRecord) {
    const responseHeader = buildDnsHeader(header.id, true, 0, 0, 0, 0);
    const questionBuf = buildQuestion(question.name, question.type);
    const fullResponse = Buffer.concat([responseHeader, questionBuf]);
    server.send(fullResponse, rinfo.port, rinfo.address);
    return;
  }

  // Record not found — return NXDOMAIN (RCODE 3)
  const responseHeader = buildDnsHeader(header.id, true, 3, 0, 0, 0);
  const questionBuf = buildQuestion(question.name, question.type);
  const fullResponse = Buffer.concat([responseHeader, questionBuf]);
  server.send(fullResponse, rinfo.port, rinfo.address);
});

// --- Server Startup ---
server.on("listening", () => {
  const addr = server.address();
  console.log(`Server listening on ${addr.address}:${addr.port}`);
});

server.bind(5333, "0.0.0.0"); // Bind to all interfaces on port 5333
