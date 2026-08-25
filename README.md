<p align="center">
  <img src="/data/openai.png" height="55" alt="OpenAI" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/razorpay" height="55" alt="Razorpay" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/nodedotjs" height="55" alt="Node.js" />
</p>

## Revive AI - Revenue Recovery Agent

</div>
<img width="1000" height="500" alt="Dashboard " src="/data/Dashboard.jpg" />

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

<img width="800" height="300" alt="Userlogin" src="https://github.com/user-attachments/assets/41f8121c-5c3a-4a2c-b582-6e8c0bf96c1d" />


---

# Measuring Revenue Recovery

ReviveAI does not count a recovery as successful merely because a payment link was generated.

The recovery is completed only after payment success is verified.


### Example

Before payment:

<img width="2398" height="326" alt="before recovery " src="https://github.com/user-attachments/assets/eff88d3d-444d-4e53-8183-c5367dfd212c" />


Customer successfully pays: ₹9,279

<img width="500" height="300" alt="Payement " src="https://github.com/user-attachments/assets/ffa248e6-8a81-4988-acd9-f6492319bfa1" />

After verification:
<img width="2418" height="350" alt="recovered " src="https://github.com/user-attachments/assets/f11b2a6a-18b9-40e2-a723-c021bdc7e2f7" />


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
| Action | Current status |

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


# Key Capabilities

## Detect Revenue at Risk

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

## Diagnose the Situation

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

# How ReviveAI Handles Recovery

## 1. Checkout Abandonment or Payment Decline

When the reason is unknown, ReviveAI does not blindly retry the payment.

The customer is asked to choose the relevant reason:

<img width="500" height="400" alt="checkout issue " src="https://github.com/user-attachments/assets/e732b0f1-b301-45a4-9b35-4e507ba05a51" />

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
<img width="500" height="400" alt="schedule " src="https://github.com/user-attachments/assets/8716a2b5-da4f-49d2-9355-9763aa4faf05" />

The customer chooses when they are ready rather than being repeatedly retried.

---

## 3. Temporary Issue

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
<img width="500" height="400" alt="technical issue " src="https://github.com/user-attachments/assets/ce5edc45-5273-4d47-b51c-3b821d1bb5c1" />

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

<img width="500" height="300" alt="technical issue " src="https://github.com/user-attachments/assets/850fcbb1-ab34-4c97-849b-b4222607db92" />


---

## 5. Payment Method Unavailable

The customer can provide structured feedback directly from the customer portal.

Information collected includes:

- Preferred payment method
- Preferred bank/provider
- What happened

Each field has a **20-character limit** with a live character counter.

<img width="500" height="400" alt="payment method " src="https://github.com/user-attachments/assets/f9312ae8-35ee-41e3-bd33-cfa1998610d0" />

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
<img width="500" height="300" alt="payment " src="https://github.com/user-attachments/assets/f2d8d7a8-fedd-4d96-92f9-e7e90a0fbe3b" />

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
<img width="500" height="300" alt="stop" src="https://github.com/user-attachments/assets/f86bad64-ab46-4df4-8c71-e6c9a6b038ac" />


The system respects explicit customer intent.

---

# Guardrails Before Action

ReviveAI is designed to recover revenue **without blindly pursuing every failed payment**.

Deterministic server-side policies define the boundaries of what the agent can execute.

The AI can recommend an action.  
The policy engine decides whether it is allowed.

- Never contact an opted-out customer
- Maximum recovery attempts per order
- Active bank or technical incidents can pause outreach
- Stopping rules always override AI recommendations
- Ambiguous cases can be escalated to human review
- Every important action is recorded

> **AI helps understand the situation and choose the appropriate workflow. Policy guardrails determine whether an action is actually allowed.**

---

# Where AI Fits In

ReviveAI uses AI for contextual diagnosis and reasoning.

The AI layer helps determine:

- What likely caused the payment failure?
- Is this a customer-specific issue or a broader incident?
- What intervention best fits the situation?
- What evidence supports the diagnosis?

The recovery agent operates as a closed loop:

<img width="500" height="150" alt="AI AGENT" src="https://github.com/user-attachments/assets/82a424bf-af18-49b1-ab2a-8c70e46d9f39" />


### AI does not override policy.

This makes ReviveAI autonomous within clearly defined safety boundaries.

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

> Never commit your real `.env` file or API secrets to GitHub.

## 4. Start the server

```bash
node server.mjs
```

Open:

```text
http://localhost:3000
```

---

# Demo Flow

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

# Why ReviveAI is Agentic

ReviveAI is not just:

- A dashboard
- A payment failure classifier
- A payment reminder tool
- A static recommendation engine

It:

1. **Observes** payment events across a batch
2. **Detects** individual failures and wider degradation patterns
3. **Reasons** about the likely root cause
4. **Chooses** an appropriate intervention
5. **Checks** whether that action is allowed by policy
6. **Executes** bounded recovery workflows
7. **Learns from new customer responses**
8. **Verifies outcomes** and updates recovered revenue

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

# The Goal

**The main objective is to recover revenue at risk intelligently and ensure users have a positive experience while completing the payment.**

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
# Future Improvements

1. **Multi-channel recovery** — Support policy-aware recovery through email, SMS, WhatsApp, and voice.
2. **Support more recovery scenarios** — Expand beyond payment failures and checkout abandonment to subscriptions, overdue invoices, mandate failures, and B2B receivables.
3. **Real-time monitoring** — Continuously detect payment degradation and trigger workflows as incidents emerge.
4. **Advanced analytics** — Track recovery rates, intervention effectiveness, customer response patterns, and revenue leakage over time.
5. **Production-grade scaling** — Add queues, persistent databases, authentication, role-based access, and monitoring for large-scale deployments.

---
<div align="center">

# Revive AI

### AI Revenue Recovery Agent

**Detect what's at risk. Take the right action. Recover responsibly.**

<br />

*Recover revenue without recovering blindly.*

</div>
