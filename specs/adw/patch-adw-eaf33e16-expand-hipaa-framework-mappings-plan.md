# Spec — Patch: Expand HIPAA mappings across all applicable control domains

- **Status:** Draft
- **Branch:** patch-issue-49-adw-eaf33e16-expand-hipaa-framework-mappings
- **Location:** `server/src/data/frameworks.json`
- **Related docs:** N/A

## Problem / Objective
**Original Spec:** N/A  
**Issue:** `frameworks.json` includes HIPAA references for only 3 of 18 control domains (Logging & Monitoring, Incident Response, HIPAA Safeguards). The remaining 15 domains — IAM, MFA, PAM, Encryption at Rest, Encryption in Transit, Vulnerability Management, Patch Management, Backup & Recovery, Business Continuity, Disaster Recovery, Data Privacy Governance, Data Subject Rights, Data Retention & Deletion, Third-Party Risk Management, and GDPR Processor Obligations — have no HIPAA mapping, making the framework coverage incomplete for HIPAA-regulated customers.  
**Solution:** Add HIPAA Security Rule (45 CFR Part 164 Subpart C) and Privacy Rule (Subpart E) citations to every domain where HIPAA safeguards apply, and bump `_version` from `2026-05-fwmap-v2` to `2026-05-fwmap-v3`.

## Approach & Changes
### Files to Modify
- `server/src/data/frameworks.json` — add `"HIPAA"` entries to 15 domains and bump `_version`

### Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add HIPAA citations to each domain missing them

Edit `server/src/data/frameworks.json` and insert a `"HIPAA"` key into each of the following domains with the citations listed below. Insert the `"HIPAA"` key after `"GDPR"` (or after whatever key precedes `"NIST 800-53"`) to keep the ordering consistent with existing domains.

| Domain | HIPAA citations |
|--------|----------------|
| **MFA** | `"164.312(d) Person or entity authentication"` |
| **Identity & Access Management** | `"164.312(a)(1) Access control"`, `"164.312(a)(2)(i) Unique user identification"` |
| **Privileged Access Management** | `"164.308(a)(3) Workforce security"`, `"164.308(a)(4) Information access management"`, `"164.312(a)(1) Access control"` |
| **Encryption at Rest** | `"164.312(a)(2)(iv) Encryption and decryption (addressable)"` |
| **Encryption in Transit** | `"164.312(e)(2)(ii) Encryption (addressable)"` |
| **Vulnerability Management** | `"164.308(a)(8) Evaluation"` |
| **Patch Management** | `"164.308(a)(8) Evaluation"` |
| **Backup & Recovery** | `"164.308(a)(7) Contingency plan"`, `"164.312(a)(2)(ii) Emergency access procedure"` |
| **Business Continuity** | `"164.308(a)(7) Contingency plan"`, `"164.308(a)(7)(ii)(B) Disaster recovery plan"` |
| **Disaster Recovery** | `"164.308(a)(7)(ii)(B) Disaster recovery plan"`, `"164.308(a)(7)(ii)(C) Emergency mode operation plan"` |
| **Data Privacy Governance** | `"164.530 Administrative requirements"`, `"164.514(b) De-identification safe harbor"` |
| **Data Subject Rights** | `"164.524 Individual right of access to PHI"`, `"164.528 Accounting of disclosures"` |
| **Data Retention & Deletion** | `"164.530(j) Documentation and record retention"`, `"164.316(b)(2) Time limit (6 years)"` |
| **Third-Party Risk Management** | `"164.308(b)(1) Business associate contracts"`, `"164.314(a) Business associate contracts and other arrangements"` |
| **GDPR Processor Obligations** | `"164.308(b)(1) Business associate contracts"`, `"164.314(a) Business associate contracts and other arrangements"` |

### Step 2: Bump the `_version` field

Change line 2:
```json
"_version": "2026-05-fwmap-v2",
```
to:
```json
"_version": "2026-05-fwmap-v3",
```

## Key Decisions & Rationale
**Lines of code to change:** ~35 (one `"HIPAA"` array per domain, plus version bump)  
**Risk level:** low — pure data change; no business logic altered; existing HIPAA domains (Logging, Incident, HIPAA Safeguards) are untouched  
**Testing required:** existing server unit tests (frameworks data is validated by the server test suite); TypeScript typecheck; client build  

Citations follow the 45 CFR Part 164 section structure exactly as used in the existing three domains so the format is consistent. Addressable implementation specifications are noted inline (per HIPAA terminology). Domains such as `Uncategorized` are intentionally excluded — that catch-all has no specific HIPAA binding.

## Verification
Execute every command from the repo root to validate the patch is complete with zero regressions.

```bash
npm run typecheck   # server + client TS checks
npm run test        # server + client unit tests
npm run build       # client production build
```

Also manually verify: after the change, every domain listed in Step 1 has a non-empty `"HIPAA"` array in `server/src/data/frameworks.json`, and `_version` reads `"2026-05-fwmap-v3"`.

## Known Limitations / Follow-ups
- `Uncategorized` domain intentionally left without a HIPAA mapping — it is a fallback bucket with no specific regulatory binding.
- The HIPAA citations use the "addressable" qualifier where the Security Rule itself marks an implementation specification as addressable (encryption entries). No change in how the portal surfaces these strings — that rendering is out of scope.
