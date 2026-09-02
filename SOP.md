# Standard Operating Procedure (SOP) & Operations Manual
## Centinl — AUSTRAC AML/CTF Independent Evaluation Portal & AI Analyzer

---

> [!IMPORTANT]
> **Regulatory Context:** This SOP governs operational procedures for **Centinl**, an AUSTRAC AML/CTF Independent Evaluation Portal aligned with the **AML/CTF Amendment Act 2024 reforms** (effective 31 March 2026).
>
> **Document Control:** Version 1.2.0 | Last Updated: March 2026  
> **Target Audience:** Compliance Officers, AML Auditors, Operations Managers, Backup Virtual Assistants (VAs)

---

## 1. Executive Summary & Application Overview

**Centinl** is an end-to-end compliance management platform and AI-assisted audit engine designed to evaluate reporting entities against Australian Anti-Money Laundering and Counter-Terrorism Financing (AML/CTF) statutory obligations.

```
┌─────────────────────────┐       ┌──────────────────────────┐       ┌────────────────────────┐
│  Client Portal          │       │  Admin Roster Console    │       │  Entity Review & AI    │
│  (audit.html)           │       │  (admin.html)            │       │  (entity.html)         │
└───────────┬─────────────┘       └────────────┬─────────────┘       └───────────┬────────────┘
            │                                  │                                 │
            └──────────────────────────┐       │       ┌─────────────────────────┘
                                       ▼       ▼       ▼
                            ┌──────────────────────────────────────┐
                            │  Centinl Express Backend API Server  │
                            │  (server.js - Dual Mount /api & /hlgp)│
                            └──────────────────┬───────────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       ▼                                               ▼
     ┌──────────────────────────────────┐            ┌──────────────────────────────────┐
     │  GoHighLevel (GHL) CRM           │            │  rag-audit AI Module             │
     │  - Contacts, Custom Fields       │            │  - Groq LLM / RAG BM25 Grounder  │
     │  - Roles (audit user/admin)      │            │  - 23 Review Areas (Q01-Q23)     │
     └──────────────────────────────────┘            └──────────────────────────────────┘
```

### Key System Features
* **No Local Database Architecture:** Operates with GoHighLevel (GHL) CRM as the source of truth. Users are GHL contacts; audit answers and document uploads map to GHL custom fields; roles map to GHL tags (`audit user` / `audit admin`).
* **AI Compliance Engine (`rag-audit`):** Automated evaluation module leveraging **Groq** (`openai/gpt-oss-120b`) grounded against official AUSTRAC guidance files indexed locally via a BM25 lexical retriever.
* **Dual API Mount:** All API paths are mounted at both `/api/...` and `/hlgp/api/...` for production reverse-proxy support.

---

## 2. Client & System Quick-Reference Matrix

### 2.1 System Metadata

| Field | Details |
| :--- | :--- |
| **Client Name** | **Centinl Compliance** |
| **Brand / Project** | Centinl AUSTRAC AML/CTF Independent Evaluation Portal |
| **Primary VA / Lead** | Lead AML Compliance Auditor / Operations Manager |
| **Backup VA(s)** | Secondary AML Auditor / Technical Systems Lead |
| **Client Folder Link** | [Centinl Master Drive Folder](https://drive.google.com/drive/folders/centinl-audit-master) |
| **Primary Channels** | **Slack:** `#centinl-ops` / `#centinl-urgent`<br>**Email:** `audit@centinl.com.au` |
| **Key System Links** | • Admin Console: `/admin`<br>• Entity Review Portal: `/entity?id=<contactId>`<br>• Technical Documentation: [README.md](file:///d:/Project/ramanadhan/backend/README.md)<br>• Deployment & Hosting Guide: [DEPLOY.md](file:///d:/Project/ramanadhan/backend/DEPLOY.md) |

### 2.2 Access & Tooling Matrix

| Tool / Service | Access Required | Purpose |
| :--- | :--- | :--- |
| **Centinl Admin Console** | Admin Token / `audit admin` GHL Tag | Onboard clients, trigger nudges, lock/unlock edit permissions. |
| **GoHighLevel CRM** | `GHL_LOCATION_ID` API Access | Manage contacts, audit questionnaire fields, and role tags. |
| **Groq AI Console** | `GROQ_API_KEY` (4,000 token output reservation) | Execute AI scoring and RAG document compliance analysis. |
| **Password Manager** | 1Password Shared Vault (`Centinl Ops`) | Access credentials for backend hosting, GHL, and email proxies. |
| **Slack Workspace** | Channels: `#centinl-ops`, `#centinl-urgent` | Communication, alert monitoring, and escalation handling. |

---

## 3. Master Operational Schedule

```
DAILY TASKS                    WEEKLY TASKS                   MONTHLY TASKS
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│ • Client Onboarding       │  │ • Overdue Audit Nudges    │  │ • AUSTRAC Index Grounding │
│ • Audit Inquiry Triage    │  │ • GHL Custom Field Audit  │  │   Refresh (rag:fetch)     │
│ • AI Scoring Execution    │  │ • Weekly Status Reporting │  │ • Groq API Quota Audit    │
│ • Draft Report Review     │  └───────────────────────────┘  │ • System Health Audit     │
└───────────────────────────┘                                 └───────────────────────────┘
```

---

## 4. Standard Operating Procedures (SOPs)

---

### SOP-01: Client Onboarding & User Invites

#### Purpose
Register new reporting entities, create corresponding GHL contact records, attach the `audit user` tag, and trigger a secure 1-hour email registration link.

#### Trigger
A new AML/CTF independent evaluation contract is executed or an onboarding request is submitted.

#### Step-by-Step Instructions

1. **Access the Console:**  
   Open your browser and navigate to `/admin` (or `/hlgp/admin`). Log in using your Admin credentials.

2. **Initiate Invitation:**  
   Click the **Invite User** button located in the top navigation bar.

3. **Populate Contact Details:**  
   Enter the following mandatory fields:
   * **First Name:** Contact person's first name.
   * **Last Name:** Contact person's last name.
   * **Email:** Official business email address of the client.
   * **Company:** Registered legal business entity name.

4. **Submit & Verify:**  
   Click **Send Invite**. The backend will automatically:
   * Create or update the contact in GoHighLevel CRM.
   * Apply the `audit user` tag.
   * Dispatch an automated invite email containing a secure token link (`/reset-password?token=...`).

5. **Confirm Roster Entry:**  
   Verify that the new client appears on the `/admin` roster table with the status **Invited**.

> [!TIP]
> If a client reports an expired invite token (valid for 1 hour), click **Reset Password / Re-invite** next to their row in the `/admin` roster to issue a fresh link.

#### Quality Checklist
- [ ] Business email and entity legal name verified against agreement.
- [ ] Contact correctly appears on `/admin` roster.
- [ ] Contact tagged with `audit user` in GHL CRM.

---

### SOP-02: Audit Progress Tracking & Bulk Reminders

#### Purpose
Monitor client questionnaire completion, review uploaded documentation, and trigger automated reminders for overdue submissions.

#### Trigger
Daily morning review at 09:00 AM EST and weekly status checks.

#### Step-by-Step Instructions

1. **Review Roster Statuses:**  
   In `/admin`, inspect the **Status** column:
   * `Invited`: Account created, user has not set password yet.
   * `In Progress`: Client logged in and saved draft audit responses.
   * `Submitted`: Audit questionnaire and file uploads finalized.

2. **Trigger Bulk Remudges for Overdue Audits:**  
   * Select the checkboxes next to clients whose audits are overdue.
   * Click **Bulk Nudge** at the top of the table.
   * The system fires `POST /api/admin/bulk-nudge`, attaching the `nudge requested` tag in GHL, which triggers automated email/SMS reminders.

3. **Audit Lock / Unlock Control:**  
   * When a client needs to amend their responses post-submission, click **Unlock Editing** on their roster row.
   * Once amendments are complete, click **Lock Editing** to re-freeze client inputs.

#### Quality Checklist
- [ ] No client remains in `Invited` state for > 3 business days without a follow-up.
- [ ] Overdue clients nudged weekly via **Bulk Nudge**.
- [ ] Client audit editing locked immediately after final auditor sign-off.

---

### SOP-03: AI Compliance Analyzer Execution (`rag-audit`)

#### Purpose
Execute automated AI evaluations of client questionnaire responses and uploaded policy documents against **23 AUSTRAC review areas (Q01–Q23)**.

#### Trigger
Client audit status updates to `Submitted`, or an auditor uploads policy documents directly.

#### Step-by-Step Instructions

1. **Open Entity Review Interface:**  
   In `/admin`, locate the client and click **Review Entity** (or navigate to `/entity?id=<contactId>`).

2. **Verify Input Evidence:**  
   * Inspect the client's custom field answers in the left column.
   * Confirm that uploaded policy files (PDF/DOCX/TXT) are attached under **Uploaded Documents**.

3. **Execute Scoring:**  
   Click **Run AI Compliance Analyzer**. The backend pipeline executes automatically:
   * **Intake & Document Parsing:** Extracts text from uploaded files (up to 12,000 character budget).
   * **RAG Grounding:** Searches the local BM25 index for relevant statutory AUSTRAC rules.
   * **Groq LLM Scoring:** Evaluates adequacy (0–10) and efficacy (0–10) across Q01–Q23.
   * **Deduction Engine:** Applies critical failure penalties and calculates the final 0–100 score.

4. **Review Results:**  
   * **Final Score & Rating:** Check overall score (e.g., `85/100 - Pass`, `42/100 - Critical Non-Compliant`).
   * **Area Statuses (Q01–Q23):** Verify that all 23 areas returned valid status badges (`adequate`, `partial`, `inadequate`, `missing`). Ensure the `incompleteModelOutput` list is empty.
   * **Grounding Citation:** Ensure `grounded: true` is displayed.

5. **Export Draft Findings:**  
   Copy the generated **Executive Summary** and **Draft Report** into the official auditor evaluation template.

> [!WARNING]
> If scanned image-only PDFs are uploaded, text extraction will fail because OCR is disabled. Request the client to upload native text-based PDFs.

#### Quality Checklist
- [ ] Score calculated (0–100) with rating and tone color.
- [ ] All 23 review areas (Q01–Q23) scored; no missing areas in `incompleteModelOutput`.
- [ ] Grounding active (`grounded: true`).
- [ ] Draft report copied to auditor evaluation record.

---

### SOP-04: AUSTRAC Knowledge Base Ingestion & Grounding Maintenance

#### Purpose
Update the local BM25 search index with official AUSTRAC guidance files so the AI compliance engine cites accurate statutory requirements.

#### Trigger
Monthly recurring task OR whenever AUSTRAC releases new AML/CTF guidance documents.

#### Step-by-Step Instructions

1. **Access Backend Server CLI:**  
   Open a terminal session on the backend server and navigate to the project directory:
   ```bash
   cd backend
   ```

2. **Option A: Auto-fetch Web Sources:**  
   Run the fetch script to download target AUSTRAC web guidance:
   ```bash
   npm run rag:fetch
   ```
   *Downloads URLs from `modules/rag-audit/knowledge-sources.json` to `knowledge/` and rebuilds the BM25 index.*

3. **Option B: Manual Document Addition:**  
   Place official AUSTRAC PDF/TXT files into `backend/knowledge/`, then run:
   ```bash
   npm run rag:ingest
   ```

4. **Verify Health:**  
   Test the AI module endpoint to confirm configuration:
   ```bash
   curl http://localhost:5001/api/rag-audit/health
   ```
   *Expected output:* `{"success":true,"configured":true,"model":"openai/gpt-oss-120b"}`

#### Quality Checklist
- [ ] `knowledge-index.json` updated with non-zero byte size.
- [ ] Health check endpoint returns `configured: true`.

---

## 5. Escalation Rules & Contingency Matrix

> [!CAUTION]
> Operational disruptions or API errors must be handled immediately according to the escalation protocol below.

| Issue / Trigger | Severity | Immediate Action | Primary Escalation Contact |
| :--- | :--- | :--- | :--- |
| **Groq API Rate Limit (429)** | **High** | Wait 60 seconds and re-run scoring. If persistent, check Groq token quota. | Technical Lead (`#centinl-urgent`) |
| **GHL API Unauthorized (401)** | **Critical** | Verify `GHL_API_KEY` in `backend/.env`. Restart server (`npm start`). | Technical Lead |
| **Score < 50/100 (Critical Non-Compliance)** | **High** | Do NOT send automated findings. Initiate mandatory manual auditor review. | Lead AML Auditor |
| **Expired Reset / Invite Token** | **Low** | Navigate to `/admin` roster and click **Reset Password / Re-invite**. | Primary VA / Support |
| **Scanned/Unreadable PDF Upload** | **Medium** | Notify client to re-upload text-based searchable PDF via `/audit`. | Primary VA |

---

## 6. Non-Delegable Tasks & Security Boundaries

To maintain production security, strict data privacy, and legal integrity under AUSTRAC regulations, **Backup VAs and lower-level operators MUST NOT perform the following tasks**:

1. **Environment Secret Management:** Modifying `.env` files (`JWT_SECRET`, `GHL_API_KEY`, `GROQ_API_KEY`).
2. **Rubric & Weighting Alterations:** Editing scoring parameters or deduction weights in `modules/rag-audit/scoring-rubric.js`.
3. **Role Elevation:** Promoting standard users to `audit admin` status.
4. **Modifying Ingestion Sources:** Editing AUSTRAC statutory source URLs in `knowledge-sources.json`.

---

## 7. Appendix: Master Handoff Reference Table

Below is the complete 3-column client handoff reference table for quick copy-paste into tracking software (Google Sheets, Notion, Excel):

| Section | Field / Item | Details |
| :--- | :--- | :--- |
| **Client Overview** | Client Name | Centinl Compliance |
| | Brand / Project | Centinl — AUSTRAC AML/CTF Independent Evaluation Portal |
| | Primary VA | Lead AML Compliance Auditor / Operations Manager |
| | Backup VA(s) suggestions | Secondary AML Auditor / Technical Systems Backup |
| | Client Folder Link | `https://drive.google.com/drive/folders/centinl-audit-master` |
| | Communication Channels | Slack (`#centinl-ops` / `#centinl-urgent`), Email (`audit@centinl.com.au`), GHL Notifications |
| | Other Links | • Admin Console: `/admin`<br>• Entity Review Portal: `/entity?id=<contactId>`<br>• Technical README: [README.md](file:///d:/Project/ramanadhan/backend/README.md)<br>• Deployment Guide: [DEPLOY.md](file:///d:/Project/ramanadhan/backend/DEPLOY.md) |
| **Task Overview (Daily / Weekly / Monthly)** | Recurring Tasks | **Daily:** Client Onboarding, Invite Link Generation, Daily Audit Inquiry Triage, AI Compliance Scoring Execution (`/entity`), Draft Report Review.<br>**Weekly:** Bulk Nudge for Pending Audits (`/api/admin/bulk-nudge`), GHL Contact & Custom Field Audit.<br>**Monthly:** AUSTRAC Knowledge Index Grounding Update (`npm run rag:fetch`), Groq API Quota Audit. |
| **Backup-Eligible Tasks** | Backup-Eligible Tasks List | 1. Client Onboarding & User Invites (via `/admin`)<br>2. AI Compliance Analyzer Execution & Scoring (via `/entity`)<br>3. Bulk Nudges / Reminders for pending audits<br>4. Unlocking / Locking Client Audit Editing |
| **SOP for Each Backup-Eligible Task** | Task Name | Client Onboarding & AI Compliance Scoring (`rag-audit`) |
| *(Red marked can be drafted in a google doc and pls insert the doc link in column C)* | Purpose | Invite reporting entities to complete their AUSTRAC AML/CTF audit, monitor submissions, and run automated AI compliance scoring against 23 AUSTRAC review areas. [Detailed Google Doc SOP Link](https://docs.google.com/document/d/example-centinl-sop) |
| | Trigger | New compliance evaluation contract signed OR client submits audit responses in portal / auditor uploads documents. |
| | Tools Required | Centinl Admin Portal (`/admin`, `/entity`), GoHighLevel (GHL) CRM, Groq AI API, 1Password / Vault. |
| | Access Required | 1. Centinl Admin Token / Admin Tag (`audit admin` in GHL) |
| | Access Required | 2. GoHighLevel Sub-Account Access (`GHL_LOCATION_ID`) |
| | Access Required | 3. 1Password Shared Vault - Centinl Admin Credentials |
| | Access Required | 4. Slack Workspace Access (`#centinl-ops` / `#centinl-urgent`) |
| | Step-by-Step Instructions | 1. Log into `/admin` console.<br>2. Click 'Invite User', enter Name, Email, Company to create/tag GHL contact and send 1-hr registration link.<br>3. Monitor roster status until 'Submitted' (run 'Bulk Nudge' for overdue clients).<br>4. Open `/entity?id=<contactId>`, review uploaded files and GHL custom fields.<br>5. Click 'Run AI Compliance Analyzer' to evaluate 23 AUSTRAC review areas (Q01-Q23).<br>6. Review final score (0-100), critical deductions, and tone indicator.<br>7. Copy Draft Report for official auditor sign-off.<br>8. Click 'Lock Editing' to freeze client audit responses. |
| | Quality Checklist | 1. Client tagged correctly as `audit user` in GHL. |
| | Quality Checklist | 2. All 23 review areas (Q01-Q23) successfully evaluated (`incompleteModelOutput` array is empty). |
| | Quality Checklist | 3. AUSTRAC Grounding verified (`grounded: true`). |
| | Quality Checklist | 4. Critical deductions (> 0) reviewed against uploaded policy documents. |
| | Quality Checklist | 5. Client editing toggled to 'Locked' after final report copy. |
| | Common Mistakes to Avoid | • Running AI scoring before client submits documentation without using `?docs=0`.<br>• Leaving client editing unlocked after issuing final audit findings.<br>• Modifying custom field names in GHL without updating backend `.env`. |
| | Escalation Rules - Must Escalate If | 1. Groq API 429 Rate Limit or 5xx server error during AI scoring. |
| | Escalation Rules - Must Escalate If | 2. GHL API key expiration or location authorization failure. |
| | Escalation Rules - Must Escalate If | 3. Score < 50/100 (Critical Non-Compliance) detected on a high-risk reporting entity. |
| | Escalation Rules - Must Escalate If | 4. Client reports expired password reset or invite token links. |
| | Escalate To | 1. Lead AML Compliance Auditor (via Slack `#centinl-urgent` / Email) |
| | Escalate To | 2. Technical Systems Lead (for server/API/environment issues) |
| | Reference Links | • Admin Console: `/admin`<br>• Entity Review Interface: `/entity`<br>• Backend Documentation: [README.md](file:///d:/Project/ramanadhan/backend/README.md)<br>• Deployment Guide: [DEPLOY.md](file:///d:/Project/ramanadhan/backend/DEPLOY.md) |
| **Tasks NOT Eligible for Backup** | Tasks NOT Eligible for Backup | **These tasks require deep context or risk breaking production:**<br>1. Direct modification of backend environment secrets (`JWT_SECRET`, `GHL_API_KEY`, `GROQ_API_KEY`).<br>2. Modifying AI scoring rubric, weights, or deduction logic in `modules/rag-audit/scoring-rubric.js`.<br>3. Promoting users to `audit admin` or managing security roles.<br>4. Re-fetching and modifying statutory AUSTRAC grounding sources (`npm run rag:fetch` / `knowledge-sources.json`). |
