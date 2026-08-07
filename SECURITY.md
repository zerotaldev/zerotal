# Security Policy

Zerotal ships session encryption, authentication flows, an ORM, and signed URLs —
security reports are taken seriously and handled with priority.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report privately through either channel:

- **GitHub:** [Report a vulnerability](https://github.com/zerotaldev/zerotal/security/advisories/new)
  (preferred — keeps the report, discussion, and fix in one private place).
- **Email:** mbilisphe13@gmail.com with the subject line `[SECURITY] <short summary>`.

Include what you can of: the affected package(s) and version, a minimal
reproduction, the impact as you understand it, and any suggested fix. A proof of
concept helps; exploitation of systems you do not own does not — please don't.

## What to expect

- **Acknowledgement within 72 hours** of the report.
- **An assessment within 7 days**: whether it is accepted as a vulnerability, its
  severity, and the planned fix window.
- **A fix or mitigation within 30 days** for accepted reports, faster for
  critical issues (remote code execution, authentication bypass, cross-tenant
  data access). Where a fix needs longer, you get a status update and a revised
  date rather than silence.
- **Credit** in the release notes and the advisory, unless you ask not to be named.

Please keep the report confidential until a fixed release is published. Once it
is, the advisory is published with the affected version range and the version
that fixes it.

## Scope

In scope: everything under `packages/` — the `@zerotal/*` packages and
`create-zerotal` as published to npm.

Out of scope: the example applications under `apps/` (they are development
fixtures, not shipped code), vulnerabilities in dependencies (report those
upstream — but do tell us if Zerotal's usage of a dependency is what makes it
exploitable), and reports that require a maliciously modified local environment.

## Supported versions

Security fixes land on the latest minor of the current major version line.

| Version | Supported |
| ------- | --------- |
| 1.1.x   | Yes       |
| < 1.1   | No        |
