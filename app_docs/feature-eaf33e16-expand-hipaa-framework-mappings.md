# Expand HIPAA Framework Mappings

**ADW ID:** eaf33e16
**Date:** 2026-05-27
**Plan-Spec:** specs/adw/patch-adw-eaf33e16-expand-hipaa-framework-mappings-plan.md

## Overview

HIPAA Security Rule and Privacy Rule citations (45 CFR Part 164) were previously mapped to only 3 of 18 control domains. This patch adds HIPAA references to the remaining 15 applicable domains, giving HIPAA-regulated customers complete framework coverage when reviewing vendor assessments.

## What Was Built

- HIPAA citations added to 15 control domains that previously had no HIPAA mapping
- `_version` bumped from `2026-05-fwmap-v2` to `2026-05-fwmap-v3`

## Technical Implementation

### Files Modified

- `server/src/data/frameworks.json`: Added `"HIPAA"` key with 45 CFR Part 164 citations to 15 domains; bumped `_version`

### Key Changes

- **MFA** — `164.312(d)` Person or entity authentication
- **Identity & Access Management** — `164.312(a)(1)` Access control, `164.312(a)(2)(i)` Unique user identification
- **Privileged Access Management** — `164.308(a)(3)` Workforce security, `164.308(a)(4)` Information access management, `164.312(a)(1)` Access control
- **Encryption at Rest** — `164.312(a)(2)(iv)` Encryption and decryption (addressable)
- **Encryption in Transit** — `164.312(e)(2)(ii)` Encryption (addressable)
- **Vulnerability Management** — `164.308(a)(8)` Evaluation
- **Patch Management** — `164.308(a)(8)` Evaluation
- **Backup & Recovery** — `164.308(a)(7)` Contingency plan, `164.312(a)(2)(ii)` Emergency access procedure
- **Business Continuity** — `164.308(a)(7)` Contingency plan, `164.308(a)(7)(ii)(B)` Disaster recovery plan
- **Disaster Recovery** — `164.308(a)(7)(ii)(B)` Disaster recovery plan, `164.308(a)(7)(ii)(C)` Emergency mode operation plan
- **Data Privacy Governance** — `164.530` Administrative requirements, `164.514(b)` De-identification safe harbor
- **Data Subject Rights** — `164.524` Individual right of access to PHI, `164.528` Accounting of disclosures
- **Data Retention & Deletion** — `164.530(j)` Documentation and record retention, `164.316(b)(2)` Time limit (6 years)
- **Third-Party Risk Management** — `164.308(b)(1)` Business associate contracts, `164.314(a)` Business associate contracts and other arrangements
- **GDPR Processor Obligations** — `164.308(b)(1)` Business associate contracts, `164.314(a)` Business associate contracts and other arrangements

## How to Use

The HIPAA citations are surfaced automatically in the portal's framework mapping view whenever a vendor assessment maps to one of the expanded domains. No user action is required.

1. Open any vendor assessment in the portal.
2. Navigate to the framework mapping or control domain view.
3. For any domain listed above, the HIPAA column now shows the applicable 45 CFR Part 164 citations alongside ISO 27001, GDPR, NIST 800-53, and NIST CSF references.

## Configuration

No configuration changes required. The data file (`server/src/data/frameworks.json`) is loaded at server startup.

## Testing

```bash
npm run typecheck   # server + client TypeScript checks
npm run test        # server + client unit tests
npm run build       # client production build
```

Manual verification: confirm every domain listed above has a non-empty `"HIPAA"` array in `server/src/data/frameworks.json`, and that `_version` reads `"2026-05-fwmap-v3"`.

## Notes

- The `Uncategorized` domain is intentionally excluded — it is a catch-all fallback bucket with no specific HIPAA regulatory binding.
- Addressable implementation specifications (encryption entries) are noted inline per HIPAA terminology, consistent with the three pre-existing HIPAA domains (Logging & Monitoring, Incident Response, HIPAA Safeguards).
- This is a pure data change; no business logic was altered.
- AI-generated framework citations are preliminary reference material. The final vendor-risk decision is always made by a human analyst.
