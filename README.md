<div align="center">

# Revive AI - Revenue Recovery Agent

</div>

</div>
<img width="1000" height="500" alt="Dashboraed " src="https://github.com/user-attachments/assets/db3d0b63-b3b6-4a6a-b09a-2c4e1a8a7bc3" />

---

## The Problem

Revenue loss rarely happens in one clean step.

A payment may fail due to insufficient funds, a temporary bank issue, an expired card, an abandoned checkout, or a technical failure. 

Yet **traditional recovery workflows** often treat every failure the same way:

```text
Payment fails → Retry payment → Send reminder → Send another reminder → Stop
```
> **This is a static workflow. It follows the same sequence regardless of what actually happened. The right recovery action depends on why the revenue is at risk.**

---

# What is Revive AI?

ReviveAI is an **AI-assisted, policy-bounded Revenue Recovery Agent**.

> It processes payment events across a batch and closes the loop between detecting a failed payment and measuring whether the revenue was actually recovered.

The agent follows a **continuous workflow:**

```text
DETECT → DIAGNOSE → DECIDE → ACT → VERIFY → ADAPT OR STOP
```
<img width="700" height="500" alt="ChatGPT Image Aug 25, 2026, 02_56_09 PM" src="https://github.com/user-attachments/assets/e4e970b2-386c-4e01-9802-cf972ddc4ac9" />

ReviveAI does not stop after identifying a problem.

**It can continue the workflow by interacting with the customer, scheduling a payment, waiting for an incident to resolve, generating a fresh payment link when eligible, verifying the result, and updating recovery metrics.**

---
# System Architecture

<img width="1000" height="500" alt="System Architecture " src="https://github.com/user-attachments/assets/2d2571e3-fabc-40e6-9733-3ccd43a672b7" />


# Key Capabilities

## 📊 Detect Revenue at Risk

ReviveAI analyses a batch of payment events and identifies recoverable revenue across situations such as:

- Payment declines
- Checkout abandonment
- Insufficient funds
- Payment timing issues
- Temporary bank or issuer degradation
- Checkout or platform degradation
- Payment method issues

The dashboard tracks:

- **Currently at risk**
- **Total revenue at risk before recovery**
- **Revenue recovered**

---

## 🧠 Diagnose the Situation

A failed payment does not automatically mean the same recovery action should be taken.

ReviveAI analyses the available payment and recovery context to determine the likely cause and appropriate next step.

| Situation | Likely Cause | Next Intervention |
|---|---|---|
| Checkout abandoned | Customer did not complete checkout | Ask customer why |
| Payment declined | Customer-specific payment issue | Ask customer why |
| Insufficient funds | Customer needs more time to pay | Schedule payment |
| Bank degradation | Temporary issuer/bank issue | Wait for resolution |
| Checkout degradation | Temporary platform issue | Wait for resolution |
| Technical issue | Problem requiring investigation | Human review |
| Payment method unavailable | Preferred method/provider unavailable | Collect feedback |
| Customer changed mind | Customer no longer wants to continue | Stop recovery |

---

# 🔄 How ReviveAI Handles Recovery

## 1. Checkout Abandonment or Payment Decline

When the reason is unknown, ReviveAI does not blindly retry the payment.

The customer is asked to choose the relevant reason:

```text
Insufficient funds / Need more time
My bank has a payment issue
I had a technical issue
Payment method unavailable
I still want to continue
I changed my mind
```

Each answer moves the recovery case into a different workflow.

---

## 2. Insufficient Funds / Need More Time

If the customer needs more time:

```text
Customer selects
"Insufficient funds / Need more time"
              ↓
Payment scheduler opens
              ↓
Customer chooses date and time
              ↓
Schedule is saved
              ↓
Scheduled time arrives
              ↓
Server rechecks recovery policy
              ↓
One fresh payment link is created
              ↓
Customer completes payment
              ↓
Payment is verified
```

The customer chooses when they are ready rather than being repeatedly retried.

---

## 3. Temporary Bank Issue

If the customer's issue matches an active bank or issuer incident:

```text
Customer reports bank issue
              ↓
Matching active incident found
              ↓
Customer is notified
              ↓
WAIT FOR RESOLUTION
              ↓
Bank incident is resolved
              ↓
Recovery policy is rechecked
              ↓
Fresh payment link is created
              ↓
Customer can complete payment
```

The agent does not treat a temporary bank outage as a reason to stop recovery.

It waits until recovery is meaningful.

---

## 4. Technical Issue

A generic technical problem is different from a known bank incident.

```text
Customer reports technical issue
              ↓
Optional description collected
              ↓
Case moves to HUMAN_REVIEW
              ↓
Customer is informed
              ↓
Support can resolve the issue
```

Customer message:

> **Thanks for letting us know. Our team will review the issue and someone will get in touch with you to help resolve it.**

---

## 5. Payment Method Unavailable

The customer can provide structured feedback directly from the customer portal.

Information collected includes:

- Preferred payment method
- Preferred bank/provider
- What happened

Each field has a **20-character limit** with a live character counter.

The feedback is saved for review and future analysis.

---

## 6. Customer Wants to Continue

If the customer selects:

> **I still want to continue**

ReviveAI performs a policy check before acting.

```text
Customer wants to continue
              ↓
Policy recheck
              ↓
Eligible?
         ↙         ↘
       YES          NO
        ↓            ↓
Create one       Do not execute
fresh link       recovery action
        ↓
Customer pays
        ↓
Payment verified
        ↓
Revenue recovered
```

A fresh payment link is generated only when the recovery is still eligible.

---

## 7. Customer Changed Their Mind

If the customer explicitly chooses:

> **I changed my mind**

The workflow becomes:

```text
STOP_RECOVERY
      ↓
Reason recorded
      ↓
No further recovery actions
```

The system respects explicit customer intent.

---

# Bounded Recovery and Stopping Rules

ReviveAI is designed to recover revenue **without blindly pursuing every failed payment**.

Deterministic server-side policies define the boundaries of what the agent can execute.

Recovery stops when:

- The customer explicitly opts out
- The customer explicitly changes their mind
- The order is invalid
- The maximum recovery attempt limit has been reached

ReviveAI does **not** stop simply because:

- A temporary bank issue is active
- A bank incident is waiting for resolution
- A checkout was abandoned and the customer has not answered
- A technical issue requires human review
- A customer needs more time to pay

This separation is important:

> **AI helps understand the situation and choose the appropriate workflow. Policy guardrails determine whether an action is actually allowed.**

---

# 🤖 Where AI Fits In

ReviveAI uses AI for contextual diagnosis and reasoning.

The AI layer helps determine:

- What likely caused the payment failure?
- Is this a customer-specific issue or a broader incident?
- What intervention best fits the situation?
- What evidence supports the diagnosis?

The recovery agent operates as a closed loop:

```text
┌──────────────┐
│   OBSERVE    │
│ Payment data │
│ Incidents    │
│ User actions │
└──────┬───────┘
       ↓
┌──────────────┐
│   DIAGNOSE   │
│ Understand   │
│ the likely   │
│ cause        │
└──────┬───────┘
       ↓
┌──────────────┐
│    DECIDE    │
│ Select the   │
│ right next   │
│ intervention │
└──────┬───────┘
       ↓
┌──────────────┐
│     ACT      │
│ Execute only │
│ allowed      │
│ actions      │
└──────┬───────┘
       ↓
┌──────────────┐
│    VERIFY    │
│ Check what   │
│ actually     │
│ happened     │
└──────┬───────┘
       ↓
┌──────────────┐
│ ADAPT / STOP │
│ Continue only│
│ if allowed   │
└──────────────┘
```

### AI does not override policy.

```text
AI REASONING
      ↓
Diagnose + Recommend
      ↓
POLICY GUARDRAILS
      ↓
Check if action is allowed
      ↓
EXECUTE BOUNDED ACTION
```

This makes ReviveAI autonomous within clearly defined safety boundaries.

---

# Customer Workflow

The admin dashboard and customer workflow are intentionally separated.

## Admin Dashboard

Used for:

- Monitoring recovery cases
- Viewing diagnoses
- Viewing recommended interventions
- Tracking workflow status
- Monitoring incidents
- Viewing notifications and link status
- Tracking revenue recovered
- Reviewing the audit trail

## Customer Portal

Used for:

- Explaining why payment was not completed
- Scheduling a payment
- Reporting a bank issue
- Reporting a technical issue
- Providing payment method feedback
- Continuing payment
- Accessing an eligible fresh payment link
- Stopping recovery

Customer actions are **not performed from the admin dashboard**.

Each customer logs in using a User ID and sees only the recovery actions relevant to them.

Example:

```text
USR-1037
USR-1036
USR-1018
```

---

# Measuring Revenue Recovery

ReviveAI does not count a recovery as successful merely because a payment link was generated.

The recovery is completed only after payment success is verified.

```text
Revenue at risk
       ↓
Recovery workflow executed
       ↓
Customer receives / accesses payment link
       ↓
Customer completes payment
       ↓
Payment provider sends update
       ↓
Payment is verified
       ↓
Recovery marked as RECOVERED
       ↓
Currently at risk decreases
       ↓
Revenue recovered increases
```

### Example

```text
Before payment:

Currently at risk: ₹4,79,559
Revenue recovered: ₹0

Customer successfully pays: ₹9,279

After verification:

Currently at risk: ₹4,70,280
Revenue recovered: ₹9,279
```

This allows ReviveAI to demonstrate **measured revenue recovered across a batch**, not just recommended actions.

---

# Audit Trail

Every important action in the recovery workflow is recorded.

<img width="400" height="600" alt="Audit Trail" src="https://github.com/user-attachments/assets/00910ec6-dffb-4f62-ab8d-324d49e341e1" />



The dashboard reflects **actual application events**.

A notification is not marked as sent unless the application executed the notification action.

A payment link is not marked as available unless it was successfully created.

Revenue is not marked as recovered until payment success is verified.

---

# Recovery Statuses

ReviveAI uses explicit workflow states to show what is happening with each case.

| Status | Meaning |
|---|---|
| `AWAITING_CUSTOMER_RESPONSE` | Waiting for the customer to choose a reason |
| `AWAITING_SCHEDULE` | Customer needs to choose a payment time |
| `SCHEDULED` | Recovery is scheduled for the selected time |
| `WAITING_FOR_BANK_RESOLUTION` | Waiting for a matching bank incident to resolve |
| `WAITING_FOR_TECHNICAL_RESOLUTION` | Waiting for a known technical incident to resolve |
| `HUMAN_REVIEW` | A human needs to investigate the issue |
| `PAYMENT_METHOD_FEEDBACK_COLLECTED` | Customer feedback was recorded |
| `READY_TO_GENERATE_LINK` | Eligible for fresh link generation |
| `RECOVERY_LINK_READY` | Fresh payment link is available |
| `RECOVERED` | Payment was successfully verified |
| `STOPPED` | Recovery cannot continue under policy |

---

---

# Dashboard

For every recovery case, the dashboard displays:

<img width="800" height="500" alt="Queue " src="https://github.com/user-attachments/assets/f9f2d11f-7d7f-4f31-b7c8-808f83e56e7a" />


| Field | Description |
|---|---|
| Order ID | Payment order being recovered |
| User ID | Customer login identifier |
| Customer | Customer associated with the case |
| Amount at risk | Revenue currently at risk |
| Likely cause | Diagnosis |
| Recommended action | Selected intervention |
| Current workflow | Current recovery state |
| Customer notified | Whether notification was executed |


The dashboard is designed for **monitoring and visibility**.

The customer portal handles customer decisions and actions.

---

# Payment Recovery

When a recovery workflow is eligible to generate a payment link, ReviveAI:

1. Rechecks hard recovery policies
2. Creates exactly one bounded fresh payment link
3. Uses a stable reference/idempotency mechanism
4. Sets a short expiry
5. Makes the link available through the recovery workflow
6. Waits for verified payment updates
7. Updates recovery metrics after successful verification

The system does not treat link creation as recovered revenue.

**Only a verified successful payment counts as recovery.**

---

# Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js |
| AI Reasoning | OpenAI API |
| Payment Integration | Razorpay |
| Payment Verification | Razorpay Webhooks |
| Storage | JSON / application persistence |
| Local Development | Node.js server |
| Webhook Tunneling | Public tunnel for local webhook testing |

---

# Getting Started

## 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_PROJECT_FOLDER>
```

## 2. Install dependencies

```bash
npm install
```

## 3. Create your environment file

Create a `.env` file in the project root.

```env
OPENAI_API_KEY=your_openai_api_key

RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret
```

Use `.env.example` as the template.

> ⚠️ Never commit your real `.env` file or API secrets to GitHub.

## 4. Start the server

```bash
node server.mjs
```

Open:

```text
http://localhost:3000
```

---

# 🧪 Demo Flow

A complete demo can follow this sequence.

### 1. Analyse the Batch

Run the recovery analysis.

Observe:

- Revenue at risk
- Different payment problems
- Different interventions
- Active incidents
- Recovery statuses

### 2. Log in as a Customer

Use a User ID from the recovery queue.

Example:

```text
USR-1037
```

The customer sees only their relevant recovery case.

### 3. Choose a Recovery Path

Demonstrate one or more scenarios:

```text
Insufficient funds
→ Schedule payment

Bank issue
→ Wait for resolution

Technical issue
→ Human review

I still want to continue
→ Generate fresh payment link

I changed my mind
→ Stop recovery
```

### 4. Complete a Payment

For an eligible case, use the generated payment link to complete payment.

### 5. Verify the Recovery

After the payment update/webhook:

- Case becomes `RECOVERED`
- Currently at risk decreases
- Revenue recovered increases
- Audit trail records the outcome

---

# 📸 Visuals

Add your project screenshots and workflow diagrams here.

## Traditional Recovery vs ReviveAI

![Traditional Recovery vs ReviveAI](assets/traditional-vs-reviveai.png)

## How ReviveAI Decides What to Do

![ReviveAI Agent Decision Flow](assets/reviveai-decision-flow.png)

> Place the images inside an `assets` folder in your repository and update the filenames above if needed.

---

# 🎯 Why ReviveAI is Agentic

ReviveAI is not just:

- A dashboard
- A payment failure classifier
- A payment reminder tool
- A static recommendation engine

It operates through a bounded feedback loop.

```text
Observe
   ↓
Reason about context
   ↓
Choose the next intervention
   ↓
Check policy boundaries
   ↓
Execute the action
   ↓
Observe what happened
   ↓
Adapt the workflow
   ↓
Verify recovery
   ↓
Stop when required
```

The agent has a clear objective:

> **Recover eligible revenue while respecting customer intent and operating within strict policy boundaries.**

---

# 🧩 Design Principles

### Context over blind retries

Different causes require different recovery actions.

### Automation with boundaries

The agent can act autonomously only within defined policies.

### Customer intent matters

Explicit opt-outs and decisions to stop are respected.

### Verify outcomes

Revenue is measured as recovered only after payment success is verified.

### Explainable actions

Every important decision and action is visible through workflow state and audit history.

---

# 🎯 The Goal

Revenue recovery should not mean chasing every failed payment.

The goal of ReviveAI is to create a smarter recovery loop:

```text
Find what is slipping away
          ↓
Understand why
          ↓
Take the right action
          ↓
Respect the customer
          ↓
Verify the outcome
          ↓
Measure what was recovered
```

---

<div align="center">

# ✦ ReviveAI

### AI Revenue Recovery Agent

**Detect what's at risk. Take the right action. Recover responsibly.**

<br />

*Recover revenue without recovering blindly.*

</div>
