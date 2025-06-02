# 🧠 DIY DNS Server in Node.js

A fully functional DNS server built from scratch using Node.js and raw UDP sockets.  
This project manually handles DNS protocol encoding and decoding — no external DNS libraries used!

---

## 🌐 What is DNS?

DNS (Domain Name System) is like the **phonebook of the Internet**. When you type a domain like `example.com`, DNS resolves it to an IP address so your browser knows where to send the request.

### 🔍 DNS Lookup Flow
```

------------------+
| Your Browser |
+--------+---------+
|
| 1. Query for example.com
v
+--------+---------+
| DNS Resolver | <-- This is what we're building!
+--------+---------+
|
| 2. Responds with IP address (e.g., 93.184.216.34)
v
+--------+---------+
| Web Server |
+------------------+
```

DNS translates:

- `example.com` ➡️ `93.184.216.34` (A record)
- `example.com` ➡️ `2001:db8::1` (AAAA record)
- `alias.com` ➡️ `example.com` (CNAME)
- `example.org` ➡️ `ns1.example.org` (NS record)

---

## 🚀 What This Project Does

This project creates a **custom DNS server** that:
- Listens for DNS queries on a specific port
- Parses and decodes the raw UDP packet
- Matches the domain against a local records table
- Builds a correct DNS response manually (no libraries!)
- Sends it back to the client

Works perfectly with tools like `dig`, `nslookup`, or even your browser (with `resolv.conf` tweaks).

---

## 🛠️ How It Works

- Listens on UDP port `5333` (can be customized)
- Parses the DNS packet manually (header + question)
- Resolves the domain from a hardcoded records object
- Builds and sends the DNS response buffer
- Handles both IPv4 and IPv6 addresses manually

---

## 📦 Setup

### 1. Clone the repository

```bash
git clone https://github.com/sinster23/custom-dns-server.git
cd diy-dns-server
node dns-server.js
```
The server will start listening on 0.0.0.0:5333.

---

## 🧾 Supported Records

The server uses a predefined in-memory record table:
```bash
{
  "example.com": [
    { type: "A", value: "1.2.3.4" },
    { type: "AAAA", value: "2001:db8::1" }
  ],
  "alias.com": [
    { type: "CNAME", value: "example.com" }
  ],
  "example.org": [
    { type: "NS", value: "ns1.example.org" }
  ],
  "ns1.example.org": [
    { type: "A", value: "9.9.9.9" }
  ]
}
```

---

## 📈 Possible Future Improvements
-Support for MX, TXT, PTR records

-Reverse DNS (in-addr.arpa)

-Zone file loading from disk

-Name compression (RFC-compliant pointers)

-TCP fallback for large DNS packets

-Command-line arguments and logging

---

## 🧑‍💻 Author
Upayan </br>
Custom DNS implementation in pure Node.js
Inspired by low-level networking challenges like CodeCrafters' DNS challenge.

---

## 📜 License
This project is open source under the MIT License.
