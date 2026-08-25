import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function analyseWithAI({
  event,
  incidents = [],
  recovery = {}
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const context = {
        paymentEvent: {
          id: event.id,
          amount: event.amount,
      
          failureCode: event.failureCode ?? null,
          providerStatus: event.providerStatus ?? null,
      
          issuer: event.issuer ?? null,
          checkoutVersion: event.checkoutVersion ?? null,
          attempts: event.attempts ?? 0,
          contacts: event.contacts ?? 0
        },

    batchIncidents: incidents,

    recoveryContext: {
      attemptCount: recovery.attemptCount || 0,
      maxAttempts: recovery.maxAttempts || 2,
      optedOut: recovery.policySnapshot?.optedOut || false,
      orderValid: recovery.orderValid !== false,
      customerFeedback: recovery.customerFeedback || null
    }
  };

  const response = await client.responses.create({
    model: "gpt-5.6-luna",

    input: [
      {
        role: "system",
        content: `
You are the reasoning component of an AI Revenue Recovery Agent.

Your task is to analyse payment recovery cases and recommend the
best recovery intervention.

You DO NOT execute payments.
You DO NOT override hard policy constraints.
You only analyse evidence and return a structured recommendation.

Use only the supplied context. Do not invent provider facts.

IMPORTANT DATA STRUCTURE:

The supplied context has these objects:

- paymentEvent
- batchIncidents
- recoveryContext

The authoritative payment failure reason is:

paymentEvent.failureCode

IMPORTANT:
Do NOT look for event.failureCode.
There is no object named "event" in the supplied context.

Examples:
- "insufficient_funds" = customer currently does not have sufficient funds
- "bank_error" = bank or issuer-side payment error
- "checkout_timeout" = checkout or platform timeout
- "abandoned" = customer abandoned checkout
- "declined" = payment was declined

Do NOT say that the failure reason is missing when
paymentEvent.failureCode contains a valid value.

Treat paymentEvent.failureCode as the primary source for diagnosing
the payment failure.

Only diagnose the failure as unknown when
paymentEvent.failureCode is:
- missing
- null
- empty
- "unknown"

Consider only:
- paymentEvent.failureCode
- paymentEvent.providerStatus
- paymentEvent.issuer
- paymentEvent.checkoutVersion
- paymentEvent.attempts
- paymentEvent.contacts
- batchIncidents
- recoveryContext.attemptCount
- recoveryContext.maxAttempts
- recoveryContext.optedOut
- recoveryContext.orderValid
- recoveryContext.customerFeedback

DIAGNOSIS RULES:

1. If paymentEvent.failureCode === "insufficient_funds":

   Diagnose a customer-level insufficient funds or payment timing issue.

   If recoveryContext.optedOut is false and
   recoveryContext.orderValid is true:

   Recommend exactly:
   "Offer customer-chosen payment schedule"

   Decision:
   "act"

2. If paymentEvent.failureCode === "bank_error":

   Check whether there is an active issuer incident in batchIncidents
   whose issuer exactly matches paymentEvent.issuer.

   If a matching incident exists:

   Diagnose a temporary issuer or bank degradation.

   Recommend exactly:
   "Wait and reassess before retrying"

   Decision:
   "wait"

   Do NOT attribute a payment to an incident affecting a different issuer.

   If no matching incident exists and the evidence is insufficient
   to safely determine the cause:

   Recommend exactly:
   "Escalate to human review"

   Decision:
   "human_review"

3. If paymentEvent.failureCode === "checkout_timeout":

   Check whether there is an active checkout incident in batchIncidents
   whose checkoutVersion exactly matches
   paymentEvent.checkoutVersion.

   If a matching incident exists:

   Diagnose temporary checkout or platform degradation.

   Recommend exactly:
   "Wait and reassess before retrying"

   Decision:
   "wait"

   Do NOT claim a checkout incident affected this payment unless
   the checkoutVersion matches exactly.

4. If paymentEvent.failureCode === "abandoned":

   Diagnose checkout abandonment.

   If recoveryContext.customerFeedback is present, treat it as customer-supplied
   evidence. Do not let it override opted-out status, invalid orders, or limits.
   Explain the evidence, but leave the final workflow status to the server.

   Feedback guidance:
   - insufficient_funds or need_more_time: recommend "Offer customer-chosen payment schedule".
   - payment_method_unavailable: recommend "Offer alternate payment method".
   - changed_mind: recommend "Stop automated recovery".
   - technical_problem without a matching incident, or other/skip: recommend "Escalate to human review".

   If there is no matching wider infrastructure incident,
   recoveryContext.orderValid is true, and
   recoveryContext.optedOut is false:

   Recommend exactly:
   "Ask customer reason"

   Decision:
   "act"

5. If paymentEvent.failureCode === "declined":

   Diagnose payment declined.

   Without a matching infrastructure incident, recommend exactly:
   "Ask customer reason"

   Decision:
   "act"

6. Only if paymentEvent.failureCode is missing, null, empty,
   or exactly "unknown":

   Diagnose the cause as unknown.

   Recommend exactly:
   "Escalate to human review"

   Decision:
   "human_review"

HARD POLICY AWARENESS:

These policy constraints take priority over all diagnosis rules.

- If recoveryContext.optedOut is true:

  Recommend exactly:
  "Stop automated recovery"

  Decision:
  "escalate"

- If recoveryContext.orderValid is false:

  Recommend exactly:
  "Stop automated recovery"

  Decision:
  "escalate"

- If recoveryContext.attemptCount is greater than or equal to
  recoveryContext.maxAttempts:

  Do not recommend another automated recovery attempt.

  Recommend exactly:
  "Escalate to human review"

  Decision:
  "escalate"

- If evidence is genuinely ambiguous or conflicts, prefer human review
  rather than recommending an unsafe automated action.

Do not recommend an intervention outside these exact supported options:

1. Offer customer-chosen payment schedule
2. Wait and reassess before retrying
3. Create a time-limited payment recovery link
4. Stop automated recovery
5. Escalate to human review
6. Offer alternate payment method
7. Ask customer reason

Return valid JSON only with this exact structure:

{
  "cause": "short root-cause diagnosis",
  "intervention": "exactly one supported intervention",
  "decision": "act | wait | human_review | escalate",
  "confidence": 0,
  "reasoning": "brief explanation based only on supplied evidence",
  "evidence": ["fact 1", "fact 2"]
}

Confidence must be an integer from 0 to 100.

FINAL CHECK BEFORE RESPONDING:

- If paymentEvent.failureCode has a value, use that value.
- Never say the failure code is missing if
  paymentEvent.failureCode is present.
- Do not invent an incident match.
- An incident must match the relevant issuer or checkoutVersion.
- Policy constraints always override the recommended recovery action.
`
      },
      {
        role: "user",
        content: JSON.stringify(context)
      }
    ]
  });

  const text = response.output_text;

  let decision;

  try {
    decision = JSON.parse(text);
  } catch {
    throw new Error(
      `AI returned invalid JSON: ${text}`
    );
  }

  const validDecisions = [
    "act",
    "wait",
    "human_review",
    "escalate"
  ];
  
  const validInterventions = [
    "Offer customer-chosen payment schedule",
    "Wait and reassess before retrying",
    "Create a time-limited payment recovery link",
    "Stop automated recovery",
    "Escalate to human review",
    "Offer alternate payment method"
    ,"Ask customer reason"
  ];
  
  if (!validDecisions.includes(decision.decision)) {
    throw new Error(
      `AI returned an invalid decision: ${decision.decision}`
    );
  }
  
  if (!validInterventions.includes(decision.intervention)) {
    throw new Error(
      `AI returned an invalid intervention: ${decision.intervention}`
    );
  }
  
  decision.confidence = Math.max(
    0,
    Math.min(100, Number(decision.confidence) || 0)
  );
  
  return decision;
}
