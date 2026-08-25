import 'dotenv/config';
import { analyseWithAI } from "./recovery-agent.mjs";
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';




console.log('Razorpay Key ID loaded:', !!process.env.RAZORPAY_KEY_ID);
console.log('Razorpay Key Secret loaded:', !!process.env.RAZORPAY_KEY_SECRET);
console.log('Razorpay Webhook Secret loaded:', !!process.env.RAZORPAY_WEBHOOK_SECRET);


console.log(
 'Razorpay mode:',
 process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_')
   ? 'TEST'
   : process.env.RAZORPAY_KEY_ID?.startsWith('rzp_live_')
     ? 'LIVE'
     : 'INVALID KEY FORMAT'
);


const root = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(root, 'data', 'recoverytwin.json');
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };


const seed = () => Array.from({ length: 30 }, (_, n) => {
  const i = n + 1;

  const code =
    i <= 8
      ? 'bank_error'
      : i <= 16
        ? 'checkout_timeout'
        : ['insufficient_funds', 'abandoned', 'declined'][(i - 17) % 3];

  return {
    id: `ORD-${1000 + i}`,
    customer: `CUS-${200 + i}`,
    userId: `USR-${1000 + i}`,
    amount: 700 + ((i * 467) % 8700),
    failureCode: code,
    issuer: i <= 8 ? 'Northstar Bank' : 'Meridian Bank',
    checkoutVersion:
      i >= 9 && i <= 16 ? 'v2.7.1' : 'v2.6.4',
    attempts: i % 12 === 0 ? 2 : 1,
    contacts: i % 14 === 0 ? 1 : 0,
    optedOut: i % 31 === 0
  };
});
const load = async () => {
 try {
   const db = JSON.parse(await readFile(dbPath, 'utf8'));
   if (reconcileStoredPolicy(db)) await save(db);
   return db;
 } catch { return { events: [], incidents: [], recoveries: [], audit: [] }; }
};
const save = async db => { await mkdir(path.dirname(dbPath), { recursive: true }); await writeFile(dbPath, JSON.stringify(db, null, 2)); };
const log = (db, message, recoveryId = null) => db.audit.unshift({ id: `audit_${Date.now()}`, at: new Date().toISOString(), message, recoveryId });
function detectIncidents(events) {
 const incidents = [];
 for (const [issuer, failures] of Object.entries(Object.groupBy(events.filter(e => e.failureCode === 'bank_error'), e => e.issuer))) if (failures.length >= 8) incidents.push({ id: `issuer_${issuer.replace(/\W/g, '_')}`, type: 'issuer_degradation', issuer, title: `Issuer degradation · ${issuer}`, detail: `${failures.length} bank errors detected in the batch. Individual outreach suppressed.`, status: 'active' });
 for (const [version, failures] of Object.entries(Object.groupBy(events.filter(e => e.failureCode === 'checkout_timeout'), e => e.checkoutVersion))) if (failures.length >= 8) incidents.push({ id: `checkout_${version.replace(/\W/g, '_')}`, type: 'checkout_degradation', checkoutVersion: version, title: `Checkout degradation · version ${version}`, detail: `${failures.length} checkout timeouts detected. Merchant incident opened.`, status: 'active' });
 return incidents;
}
const CANONICAL_STATES = new Set(['AWAITING_CUSTOMER_RESPONSE', 'AWAITING_CUSTOMER_CONFIRMATION', 'AWAITING_SCHEDULE', 'SCHEDULED', 'WAITING_FOR_BANK_RESOLUTION', 'WAITING_FOR_TECHNICAL_RESOLUTION', 'PAYMENT_METHOD_FEEDBACK_COLLECTED', 'HUMAN_REVIEW', 'READY_TO_GENERATE_LINK', 'RECOVERY_LINK_READY', 'RECOVERED', 'STOPPED']);
const TERMINAL_STATUSES = new Set(['RECOVERED', 'STOPPED']);
const INTERVENTIONS = Object.freeze({ SCHEDULE_PAYMENT: 'SCHEDULE_PAYMENT', WAIT_AND_RETRY_AFTER_RESOLUTION: 'WAIT_AND_RETRY_AFTER_RESOLUTION', COLLECT_PAYMENT_METHOD_ISSUE: 'COLLECT_PAYMENT_METHOD_ISSUE', ASK_CUSTOMER_REASON: 'ASK_CUSTOMER_REASON', GENERATE_AND_SEND_NEW_LINK: 'GENERATE_AND_SEND_NEW_LINK', STOP_RECOVERY: 'STOP_RECOVERY', HUMAN_REVIEW: 'HUMAN_REVIEW' });
const FEEDBACK_REASONS = new Set(['insufficient_funds', 'bank_issue', 'technical_problem', 'payment_method_issue', 'payment_method_unavailable', 'need_more_time', 'continue', 'changed_mind', 'other', 'skip']);
function hasMatchingIncident(event, incidents) {
 return incidents.some(incident => incident.status === 'active' && (
   (incident.type === 'issuer_degradation' && incident.issuer === event.issuer) ||
   (incident.type === 'checkout_degradation' && incident.checkoutVersion === event.checkoutVersion)
 ));
}
function normalInterventionFor(event = {}, incidents = []) {
 if (event.failureCode === 'abandoned' || event.failureCode === 'declined') {
   return hasMatchingIncident(event, incidents)
     ? INTERVENTIONS.WAIT_AND_RETRY_AFTER_RESOLUTION
     : INTERVENTIONS.ASK_CUSTOMER_REASON;
 }
 if (event.failureCode === 'insufficient_funds') {
   return INTERVENTIONS.SCHEDULE_PAYMENT;
 }
 if (event.failureCode === 'checkout_timeout') {
   return hasMatchingIncident(event, incidents)
     ? INTERVENTIONS.WAIT_AND_RETRY_AFTER_RESOLUTION
     : INTERVENTIONS.GENERATE_AND_SEND_NEW_LINK;
 }
 if (event.failureCode === 'bank_error' && hasMatchingIncident(event, incidents)) {
   return INTERVENTIONS.WAIT_AND_RETRY_AFTER_RESOLUTION;
 }
 return INTERVENTIONS.HUMAN_REVIEW;
}


function stopForPolicy(
 recovery,
 incidents = [],
 reason = hardStopReason(recovery)
) {
 recovery.intervention = INTERVENTIONS.STOP_RECOVERY;


 Object.assign(
   recovery,
   workflowFor(INTERVENTIONS.STOP_RECOVERY, recovery.event)
 );


 recovery.status = 'STOPPED';


 recovery.stopReason =
   reason ||
   recovery.stopReason ||
   'Recovery stopped by policy';


 recovery.stoppedAt ??= new Date().toISOString();


 return recovery;
}
function hardStopReason(recovery) {
 if (recovery.customerFeedback?.reason === 'changed_mind') {
   return 'CUSTOMER_CHANGED_MIND';
 }


 if (recovery.policySnapshot?.optedOut === true) {
   return 'CUSTOMER_OPTED_OUT';
 }


 if (recovery.orderValid === false) {
   return 'INVALID_ORDER';
 }


 const recoveryAttempts = Number(
   recovery.recoveryAttemptCount ?? recovery.attemptCount ?? 0
 );


 const maxRecoveryAttempts = Number(
   recovery.maxRecoveryAttempts ?? recovery.maxAttempts ?? 2
 );


 if (recoveryAttempts >= maxRecoveryAttempts) {
   return 'MAX_ATTEMPTS_REACHED';
 }


 return null;
}
function hasHardStop(recovery) {
 return hardStopReason(recovery) !== null;
}


function hardPolicyStatus(recovery) {
 if (recovery.status === 'RECOVERED') return 'RECOVERED';
 if (recovery.status === 'STOPPED') return 'STOPPED';
 return hardStopReason(recovery) ? 'STOPPED' : null;
}
function workflowFor(intervention, event = {}) {
 const workflows = {
   [INTERVENTIONS.SCHEDULE_PAYMENT]: {
     status: 'AWAITING_SCHEDULE',
     action: 'Schedule payment at customer-selected time'
   },


   [INTERVENTIONS.WAIT_AND_RETRY_AFTER_RESOLUTION]: {
     status:
       event.failureCode === 'checkout_timeout'
         ? 'WAITING_FOR_TECHNICAL_RESOLUTION'
         : 'WAITING_FOR_BANK_RESOLUTION',
     action: 'Wait and retry after resolution'
   },


   [INTERVENTIONS.COLLECT_PAYMENT_METHOD_ISSUE]: {
     status: 'PAYMENT_METHOD_FEEDBACK_COLLECTED',
     action: 'Collect payment-method issue for admin review'
   },


   [INTERVENTIONS.ASK_CUSTOMER_REASON]: {
     status: 'AWAITING_CUSTOMER_RESPONSE',
     action: 'Ask customer why checkout was not completed'
   },


   [INTERVENTIONS.GENERATE_AND_SEND_NEW_LINK]: {
     status: 'READY_TO_GENERATE_LINK',
     action: 'Generate exactly one fresh payment link'
   },


   [INTERVENTIONS.STOP_RECOVERY]: {
     status: 'STOPPED',
     action: 'Stop recovery'
   },


   [INTERVENTIONS.HUMAN_REVIEW]: {
     status: 'HUMAN_REVIEW',
     action: 'Escalate technical issue for human review'
   }
 };


 return workflows[intervention];
}
function getWorkflowFor(intervention, event = {}) {
 const workflow = workflowFor(intervention, event);


 if (!workflow) {
   console.error(
     'Unknown intervention passed to workflowFor:',
     intervention
   );


   return {
     status: 'AWAITING_CUSTOMER_RESPONSE',
     action: 'Ask customer why checkout was not completed'
   };
 }


 return workflow;
}
function reconcileStoredPolicy(db) {
 let changed = false;


 for (const recovery of db.recoveries || []) {
   // Ensure customer name exists
   if (!recovery.customerName) {
     recovery.customerName = customerNameFor(recovery);
     changed = true;
   }


   // Keep attempt count in sync with the original event
   const priorAttempts = Number(recovery.event?.attempts || 0);


   if (priorAttempts > Number(recovery.attemptCount || 0)) {
     recovery.attemptCount = priorAttempts;
     changed = true;
   }


   // Convert legacy statuses into current canonical statuses
   const legacyStates = {
     suppressed: 'STOPPED',


     awaiting_approval: 'READY_TO_GENERATE_LINK',
     approved_pending_credentials: 'READY_TO_GENERATE_LINK',


     awaiting_reassessment: 'WAITING_FOR_BANK_RESOLUTION',


     escalated: 'HUMAN_REVIEW',
     human_review: 'HUMAN_REVIEW',


     expired: 'HUMAN_REVIEW',


     recovered: 'RECOVERED',


     link_created: 'RECOVERY_LINK_READY',


     scheduled: 'SCHEDULED',


     awaiting_schedule: 'AWAITING_SCHEDULE',


     awaiting_customer_feedback: 'AWAITING_CUSTOMER_RESPONSE'
   };


   if (legacyStates[recovery.status]) {
     recovery.status = legacyStates[recovery.status];
     changed = true;
   }


   // Unknown legacy state:
   // Do not automatically escalate to HUMAN_REVIEW.
   // If the reason is unclear, ask the customer.
   if (!CANONICAL_STATES.has(recovery.status)) {
     recovery.status = 'AWAITING_CUSTOMER_RESPONSE';
     recovery.intervention = INTERVENTIONS.ASK_CUSTOMER_REASON;
     changed = true;
   }


   // A recovered case is immutable. A stopped policy case still needs its
   // diagnostic recommendation preserved for the admin queue.
   if (recovery.status === 'RECOVERED') {
     continue;
   }


   if (recovery.status === 'STOPPED') {
     if (recovery.stopReason !== 'CUSTOMER_CHANGED_MIND') {
       const before = recovery.intervention;
       preserveRecommendationWhenStopped(recovery, db.incidents);
       changed ||= before !== recovery.intervention;
     }
     continue;
   }


   // Apply ONLY legitimate hard-stop rules.
   const hardStop = hardPolicyStatus(recovery);


   if (!hardStop) {
     continue;
   }


   stopForPolicy(recovery, db.incidents);


   log(
     db,
     `${recovery.orderId}: recovery stopped — ${recovery.stopReason}.`,
     recovery.id
   );


   changed = true;
 }


 return changed;
}
function applyCustomerFeedbackDecision(recovery, event, incidents) {
 // =====================================================
 // 1. HARD POLICY CHECK
 // =====================================================
 const hardStop = hardPolicyStatus(recovery);


 if (hardStop === 'STOPPED') {
   preserveRecommendationWhenStopped(recovery, incidents);
   return {
     intervention: recovery.intervention,
     stopReason:
       hardStopReason(recovery) ||
       recovery.stopReason ||
       'Recovery stopped by policy',
     status: 'STOPPED',
     action: recovery.action || getWorkflowFor(recovery.intervention, event).action
   };
 }


 // A recovered case must never be routed again.
 if (hardStop === 'RECOVERED') {
   return {
     intervention: recovery.intervention,
     status: 'RECOVERED',
     action: recovery.action || 'Payment successfully recovered'
   };
 }


 // =====================================================
 // 2. READ THE CUSTOMER'S CHOICE
 // =====================================================
 const reason = recovery.customerFeedback?.reason;


 // =====================================================
 // 3. INSUFFICIENT FUNDS / NEED MORE TIME
 // =====================================================
 if (
   reason === 'insufficient_funds' ||
   reason === 'need_more_time'
 ) {
   const intervention = INTERVENTIONS.SCHEDULE_PAYMENT;


   return {
     intervention,
     ...getWorkflowFor(intervention, event)
   };
 }


 // =====================================================
 // 4. CUSTOMER REPORTS BANK ISSUE
 // =====================================================
 if (reason === 'bank_issue') {
   const matchingIncident = hasMatchingIncident(
     event,
     incidents
   );


   if (matchingIncident) {
     const intervention =
       INTERVENTIONS.WAIT_AND_RETRY_AFTER_RESOLUTION;


     return {
       intervention,
       ...getWorkflowFor(intervention, event)
     };
   }


   // No known matching bank incident.
   // Do not pretend that we know the cause.
   const intervention = INTERVENTIONS.HUMAN_REVIEW;


   return {
     intervention,
     ...getWorkflowFor(intervention, event)
   };
 }


 // =====================================================
 // 5. GENERIC CUSTOMER TECHNICAL ISSUE
 // =====================================================
 if (reason === 'technical_problem') {
   const intervention = INTERVENTIONS.HUMAN_REVIEW;


   return {
     intervention,
     ...getWorkflowFor(intervention, event)
   };
 }


 // =====================================================
 // 6. PAYMENT METHOD UNAVAILABLE
 // =====================================================
 if (
   reason === 'payment_method_issue' ||
   reason === 'payment_method_unavailable'
 ) {
   const intervention =
     INTERVENTIONS.COLLECT_PAYMENT_METHOD_ISSUE;


   return {
     intervention,
     ...getWorkflowFor(intervention, event)
   };
 }


 // =====================================================
 // 7. CUSTOMER WANTS TO CONTINUE
 // =====================================================
 if (reason === 'continue') {
   // Hard policy was already rechecked above.
   const intervention =
     INTERVENTIONS.GENERATE_AND_SEND_NEW_LINK;


   return {
     intervention,
     ...getWorkflowFor(intervention, event)
   };
 }


 // =====================================================
 // 8. CUSTOMER CHANGED THEIR MIND
 // =====================================================
 if (reason === 'changed_mind') {
   const intervention = INTERVENTIONS.STOP_RECOVERY;


   return {
     intervention,
     stopReason: 'CUSTOMER_CHANGED_MIND',
     ...getWorkflowFor(intervention, event)
   };
 }


 // =====================================================
 // 9. UNKNOWN / MISSING RESPONSE
 // =====================================================
 // Never automatically stop recovery or send it to human
 // review merely because the reason is unclear.
 const intervention = INTERVENTIONS.ASK_CUSTOMER_REASON;


 return {
   intervention,
   ...getWorkflowFor(intervention, event)
 };
}
function notifyCustomer(recovery, message, type = 'info') {
 recovery.customerNotifications ??= [];
 recovery.customerNotifications.unshift({ id: `notice_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, at: new Date().toISOString(), type, message });
}
function customerNameFor(recovery) {
 if (recovery.customerName || recovery.event?.customerName) return recovery.customerName || recovery.event.customerName;
 const names = ['Aarav', 'Ananya', 'Kabir', 'Meera', 'Vihaan', 'Diya', 'Arjun', 'Isha'];
 const number = Number(String(recovery.userId || recovery.orderId || '0').replace(/\D/g, '')) || 0;
 return names[number % names.length];
}
function publicRecovery(recovery) {
 const workflowStatus = recovery.status;
 return { id: recovery.id, orderId: recovery.orderId, userId: recovery.userId, customerName: customerNameFor(recovery), amount: recovery.amount, workflowStatus, intervention: recovery.intervention, action: recovery.action, customerResponse: Boolean(recovery.customerFeedback), scheduledFor: recovery.scheduledFor, paymentLink: workflowStatus === 'RECOVERY_LINK_READY' ? { shortUrl: recovery.paymentLink?.shortUrl } : null, notifications: recovery.customerNotifications || [] };
}
function customerPortalState(db, userId) {
 const recoveries = db.recoveries.filter(item => item.userId === userId);
 const initialAtRisk = recoveries.reduce((sum, recovery) => sum + Number(recovery.amount || 0), 0);
 const recovered = recoveries.filter(recovery => ['recovered', 'RECOVERED'].includes(recovery.status))
   .reduce((sum, recovery) => sum + Number(recovery.recoveredAmount ?? recovery.amount ?? 0), 0);
 // Retained for older cached clients; the customer UI deliberately does not display these internal metrics.
 return { userId, metrics: { initialAtRisk, recovered, currentAtRisk: initialAtRisk - recovered }, recoveries: recoveries.map(publicRecovery) };
}
function state(db) {
 const recoveries = db.recoveries || [];


 // Total amount originally identified as at risk
 const initialAtRisk = recoveries.reduce(
   (total, recovery) => total + Number(recovery.amount || 0),
   0
 );


 // Money confirmed as recovered through Razorpay
 const recovered = recoveries
   .filter(recovery => ['recovered', 'RECOVERED'].includes(recovery.status))
   .reduce(
     (total, recovery) => total + Number(recovery.recoveredAmount ?? recovery.amount ?? 0),
     0
   );


 // Only a verified Razorpay payment reduces active revenue at risk.
 const currentAtRisk = initialAtRisk - recovered;
 const protectedCount = recoveries.filter(recovery => recovery.status === 'STOPPED').length;
 const actionableCount = recoveries.filter(recovery => !TERMINAL_STATUSES.has(recovery.status)).length;


 return {
   metrics: {
     events: (db.events || []).length,
     incidents: (db.incidents || []).length,


     initialAtRisk,
     currentAtRisk,
     recovered,
     protectedCount,
     actionableCount
   },


   recoveries,
   incidents: db.incidents || [],
   audit: db.audit || []
 };
}


async function createPaymentLink(recovery) {
 const keyId = process.env.RAZORPAY_KEY_ID;
 const keySecret = process.env.RAZORPAY_KEY_SECRET;


 if (!keyId || !keySecret) {
   throw new Error('Razorpay credentials are missing.');
 }


 if (!recovery.linkGeneration?.idempotencyKey) {
   throw new Error(
     'Payment link generation key is missing.'
   );
 }


 const referenceId =
 `revive_${String(recovery.id).slice(-8)}_${Date.now().toString(36)}`;


const auth = Buffer.from(
 `${keyId}:${keySecret}`
).toString('base64');


const payload = {
 amount: Math.round(Number(recovery.amount) * 100),
 currency: 'INR',


 reference_id: referenceId,


 description: `Revive AI: ${recovery.orderId}`,


 expire_by:
   Math.floor(Date.now() / 1000) + 30 * 60,


 reminder_enable: false,


 notes: {
   recovery_case_id: String(recovery.id),
   order_id: String(recovery.orderId),
   policy: 'bounded_recovery'
 }
};


 console.log(
   `Creating Payment Link for ${recovery.orderId}`
 );


 console.log(
   `Reference ID: ${referenceId}`
 );


 const response = await fetch(
   'https://api.razorpay.com/v1/payment_links',
   {
     method: 'POST',


     headers: {
       'Content-Type': 'application/json',
       Authorization: `Basic ${auth}`
     },


     body: JSON.stringify(payload)
   }
 );


 const responseText = await response.text();


 let responseData = null;


 try {
   responseData = responseText
     ? JSON.parse(responseText)
     : null;
 } catch {
   responseData = null;
 }


 if (!response.ok) {
   console.error(
     'Razorpay API error:',
     response.status,
     responseText
   );


   const error = new Error(
     `Razorpay Payment Link creation failed (${response.status}): ${responseText}`
   );


   error.statusCode = response.status;


   error.rateLimited = response.status === 429;


   error.providerError =
     responseData?.error?.code || null;


   throw error;
 }


 const link = responseData;


 if (!link?.id || !link?.short_url) {
   throw new Error(
     'Razorpay returned an invalid payment link response.'
   );
 }


 console.log(
   `Payment Link created: ${link.id}`
 );


 return {
   status: 'created',


   id: link.id,


   shortUrl: link.short_url,


   referenceId,


   createdAt: new Date().toISOString()
 };
}




const linkCreationInFlight = new Set();


// If a process crashes after persisting state:'CREATING' but before
// Razorpay responds, the recovery must not stay stuck forever. Any
// CREATING generation older than this is treated as abandoned and
// eligible for retry.
const LINK_GENERATION_STALE_MS = 5 * 60 * 1000; // 5 minutes




function buildLinkGenerationKey(recovery, source) {
 const safeRecoveryId = String(recovery.id)
   .replace(/[^a-zA-Z0-9]/g, '')
   .slice(-12);


 const safeSource = String(source || 'recovery')
   .replace(/[^a-zA-Z0-9]/g, '')
   .slice(0, 12);


 return [
   'rt',
   safeRecoveryId,
   safeSource,
   Date.now(),
   Math.random().toString(36).slice(2, 7)
 ].join('_');
}




async function createRecoveryLinkOnce(
 db,
 recovery,
 source
) {
 // ================================================
 // 1. NEVER CREATE A LINK FOR A HARD-STOPPED CASE
 // ================================================


 const policyStatus = hardPolicyStatus(recovery);


 if (
   policyStatus === 'STOPPED' ||
   policyStatus === 'RECOVERED'
 ) {
   return {
     ok: false,
     error: 'Recovery action is no longer allowed by policy'
   };
 }


 // ================================================
 // 2. REUSE AN EXISTING READY LINK
 // ================================================


 if (
   recovery.paymentLink?.id &&
   recovery.paymentLink?.shortUrl &&
   recovery.status === 'RECOVERY_LINK_READY'
 ) {
   return {
     ok: true,
     existing: true,
     link: recovery.paymentLink
   };
 }


 // ================================================
 // 3. DO NOT DUPLICATE AN IN-FLIGHT REQUEST
 // ================================================


 if (linkCreationInFlight.has(recovery.id)) {
   return {
     ok: true,
     pending: true
   };
 }


 // ================================================
 // 4. RATE-LIMIT COOLDOWN
 // ================================================


 const rateLimitRetryAt =
   recovery.linkGeneration?.retryAfter
     ? new Date(
         recovery.linkGeneration.retryAfter
       ).getTime()
     : 0;


 if (
   recovery.linkGeneration?.rateLimited === true &&
   rateLimitRetryAt > Date.now()
 ) {
   return {
     ok: false,
     deferred: true,
     rateLimited: true,
     retryAfter:
       recovery.linkGeneration.retryAfter,
     error:
       'Payment link generation is temporarily deferred after a provider rate limit.'
   };
 }


 // ================================================
 // 5. PERSISTENT GENERATION GUARD
 // ================================================


 if (
   recovery.linkGeneration?.state === 'CREATING'
 ) {
   const startedAtMs = recovery.linkGeneration.startedAt
     ? new Date(recovery.linkGeneration.startedAt).getTime()
     : 0;


   const isStale =
     !startedAtMs ||
     Date.now() - startedAtMs > LINK_GENERATION_STALE_MS;


   if (!isStale) {
     return {
       ok: true,
       pending: true
     };
   }


   // The generation was never resolved (state:'CREATING' persisted,
   // but the process likely crashed before Razorpay responded).
   // Do NOT return pending forever — fall through to step 6, which
   // reuses the existing idempotencyKey/retryCount and starts a
   // fresh attempt.
   log(
     db,
     `${recovery.orderId}: stale link-generation state detected ` +
     `(started ${recovery.linkGeneration.startedAt}); retrying.`,
     recovery.id
   );
 }


 // ================================================
 // 6. START / RETRY LINK GENERATION
 // ================================================


 linkCreationInFlight.add(recovery.id);


 const now = new Date().toISOString();


 recovery.intervention =
   INTERVENTIONS.GENERATE_AND_SEND_NEW_LINK;


 recovery.status =
   'READY_TO_GENERATE_LINK';


 // IMPORTANT:
 // Preserve retryCount and the existing idempotency key.
 // This prevents a retry from becoming a completely new
 // generation action.
 recovery.linkGeneration = {
   ...recovery.linkGeneration,


   state: 'CREATING',


   idempotencyKey:
     recovery.linkGeneration?.idempotencyKey ||
     buildLinkGenerationKey(
       recovery,
       source
     ),


   source,


   startedAt: now,


   completedAt: null,


   failedAt: null,


   error: null,


   rateLimited: false,


   retryAfter: null,


   retryCount:
     Number(
       recovery.linkGeneration?.retryCount || 0
     )
 };


 // Persist BEFORE calling Razorpay.
 await save(db);


 try {
   // ================================================
   // 7. EXACTLY ONE PROVIDER CALL
   // ================================================


   const link =
     await createPaymentLink(recovery);


   // ================================================
   // 8. SAVE SUCCESS
   // ================================================


   recovery.paymentLink = link;


   recovery.linkGeneration.state =
     'COMPLETED';


   recovery.linkGeneration.completedAt =
     new Date().toISOString();


   recovery.linkGeneration.failedAt =
     null;


   recovery.linkGeneration.error =
     null;


   recovery.linkGeneration.rateLimited =
     false;


   recovery.linkGeneration.retryAfter =
     null;


   // A successful link ends the retry cycle.
   recovery.linkGeneration.retryCount = 0;


   // IMPORTANT:
   // Count only links successfully created by Revive.
   recovery.recoveryAttemptCount =
     Number(
       recovery.recoveryAttemptCount || 0
     ) + 1;


   recovery.lastAttemptAt =
     new Date().toISOString();


   recovery.status =
     'RECOVERY_LINK_READY';


   notifyCustomer(
     recovery,
     'Here is your link to finish your payment.',
     'link_created'
   );


   log(
     db,
     `${recovery.userId}: fresh payment link created (${source}).`,
     recovery.id
   );


   await save(db);


   return {
     ok: true,
     link
   };


 } catch (error) {
   // ================================================
   // 9. HANDLE PROVIDER FAILURE
   // ================================================


   const isRateLimited =
     error.rateLimited === true ||
     error.statusCode === 429 ||
     /\b429\b/.test(
       String(error.message || '')
     ) ||
     String(error.message || '').includes(
       'RATE_LIMIT_EXCEEDED'
     );


   const failedNow = new Date();


   // CRITICAL:
   // Do not leave this as CREATING.
   // Otherwise future retries will be blocked forever.
   recovery.linkGeneration.state =
     'FAILED';


   recovery.linkGeneration.failedAt =
     failedNow.toISOString();


   recovery.linkGeneration.error =
     error.message;


   recovery.linkGeneration.rateLimited =
     isRateLimited;


   if (isRateLimited) {
     // Wait 10 minutes before the scheduler retries.
     const retryAfter = new Date(
       failedNow.getTime() + 10 * 60 * 1000
     );


     recovery.linkGeneration.retryAfter =
       retryAfter.toISOString();


     // Do NOT increment here.
     // processDueRecoveries() increments retryCount
     // immediately before each actual retry.


     recovery.linkGeneration.retryCount =
       Number(
         recovery.linkGeneration.retryCount || 0
       );


     log(
       db,
       `${recovery.orderId}: Razorpay rate limit reached. ` +
       `Payment link generation will retry after ` +
       `${retryAfter.toISOString()}.`,
       recovery.id
     );


     notifyCustomer(
       recovery,
       'We are temporarily preparing your payment link. Please check back shortly.'
     );


   } else {
     // Non-429 provider failure.
     // Keep recovery alive, but don't repeatedly retry
     // automatically without a specific retry policy.
     recovery.linkGeneration.retryAfter =
       null;


     log(
       db,
       `${recovery.orderId}: payment link generation failed due to a provider error.`,
       recovery.id
     );
   }


   // Never stop recovery merely because the provider failed.
   recovery.status =
     'READY_TO_GENERATE_LINK';


   await save(db);


   return {
     ok: false,
     error: error.message,
     rateLimited: isRateLimited
   };


 } finally {
   // ================================================
   // 10. RELEASE IN-MEMORY LOCK
   // ================================================


   linkCreationInFlight.delete(
     recovery.id
   );
 }
}
async function processDueRecoveries() {
 const db = await load();
 const now = new Date();


 const MAX_RATE_LIMIT_RETRIES = 3;


 // ==========================================
 // 1. PROCESS DUE SCHEDULED RECOVERIES
 // ==========================================
 const scheduledRecoveries = db.recoveries.filter(
   recovery =>
     recovery.status === 'SCHEDULED' &&
     recovery.scheduledFor &&
     new Date(recovery.scheduledFor) <= now
 );


 for (const recovery of scheduledRecoveries) {
   const policyStop = hardPolicyStatus(recovery);


   if (policyStop) {
     stopForPolicy(recovery, db.incidents);


     log(
       db,
       `${recovery.orderId}: scheduled recovery stopped — ${recovery.stopReason}.`,
       recovery.id
     );


     continue;
   }


   await createRecoveryLinkOnce(
     db,
     recovery,
     'scheduled_recovery'
   );
 }


 // ==========================================
 // 1b. RECOVER CASES STUCK IN A STALE CREATING STATE
 // ==========================================
 // Covers crashes between save(db) marking CREATING and the
 // Razorpay response, which would otherwise wedge the case forever
 // (customers only reach createRecoveryLinkOnce again via the
 // "continue" action, which may never be clicked again).
 const staleCreatingRecoveries = db.recoveries.filter(
   recovery =>
     recovery.linkGeneration?.state === 'CREATING' &&
     recovery.linkGeneration?.startedAt &&
     now.getTime() -
       new Date(recovery.linkGeneration.startedAt).getTime() >
       LINK_GENERATION_STALE_MS
 );


 for (const recovery of staleCreatingRecoveries) {
   const policyStop = hardPolicyStatus(recovery);


   if (policyStop) {
     stopForPolicy(recovery, db.incidents);


     log(
       db,
       `${recovery.orderId}: stale generation stopped — ${recovery.stopReason}.`,
       recovery.id
     );


     continue;
   }


   await createRecoveryLinkOnce(
     db,
     recovery,
     'stale_generation_recovery'
   );
 }


 // ==========================================
 // 2. RETRY CASES AFTER RAZORPAY 429 COOLDOWN
 // ==========================================
 const rateLimitedRecoveries = db.recoveries.filter(
   recovery =>
     recovery.status === 'READY_TO_GENERATE_LINK' &&
     recovery.linkGeneration?.rateLimited === true &&
     recovery.linkGeneration?.retryAfter &&
     new Date(recovery.linkGeneration.retryAfter) <= now &&
     Number(recovery.linkGeneration?.retryCount || 0) <
       MAX_RATE_LIMIT_RETRIES
 );


 for (const recovery of rateLimitedRecoveries) {
   const policyStop = hardPolicyStatus(recovery);


   if (policyStop) {
     stopForPolicy(recovery, db.incidents);


     log(
       db,
       `${recovery.orderId}: rate-limited recovery stopped — ${recovery.stopReason}.`,
       recovery.id
     );


     continue;
   }


   // Count this retry attempt.
   recovery.linkGeneration.retryCount =
     Number(recovery.linkGeneration.retryCount || 0) + 1;


   // Clear the old cooldown so this retry can run.
   recovery.linkGeneration.rateLimited = false;
   recovery.linkGeneration.retryAfter = null;


   log(
     db,
     `${recovery.orderId}: retrying payment link generation after rate-limit cooldown. Retry ${recovery.linkGeneration.retryCount}/${MAX_RATE_LIMIT_RETRIES}.`,
     recovery.id
   );


   await createRecoveryLinkOnce(
     db,
     recovery,
     'rate_limit_retry'
   );
 }


 // ==========================================
 // 3. HANDLE CASES THAT EXHAUSTED ALL RETRIES
 // ==========================================
 for (const recovery of db.recoveries) {
   const retryCount = Number(
     recovery.linkGeneration?.retryCount || 0
   );


   const retriesExhausted =
     retryCount >= MAX_RATE_LIMIT_RETRIES;


   if (
     recovery.status !== 'READY_TO_GENERATE_LINK' ||
     recovery.linkGeneration?.rateLimited !== true ||
     !retriesExhausted
   ) {
     continue;
   }


   recovery.intervention = INTERVENTIONS.HUMAN_REVIEW;
   recovery.status = 'HUMAN_REVIEW';
   recovery.action =
     'Payment link creation needs provider review';


   log(
     db,
     `${recovery.orderId}: moved to human review after ${MAX_RATE_LIMIT_RETRIES} rate-limit retries.`,
     recovery.id
   );
 }


 await save(db);
}
const respond = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
async function json(req) { let value = ''; for await (const part of req) value += part; return value ? JSON.parse(value) : {}; }
async function rawBody(req) { let value = ''; for await (const part of req) { value += part; if (value.length > 1_000_000) throw new Error('Request body too large'); } return value; }
function validWebhookSignature(payload, signature) {
 const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
 if (!secret || !signature) return false;
 const expected = createHmac('sha256', secret).update(payload).digest('hex');
 return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}


createServer(async (req, res) => {
 try {
   const url = new URL(req.url, `http://${req.headers.host}`), db = await load();
   if (req.method === 'GET' && url.pathname === '/api/health') return respond(res, 200, { ok: true });
   if (req.method === 'GET' && url.pathname === '/api/state') return respond(res, 200, state(db));
   if (req.method === 'POST' && url.pathname === '/api/analyse') {
     const input = await json(req);
  
     db.events =
       Array.isArray(input.events) && input.events.length
         ? input.events
         : seed();
  
     // Step 1: deterministic batch-level detection
     db.incidents = detectIncidents(db.events);
  
     // Step 2: send each individual case to the LLM agent
     db.recoveries = await Promise.all(
       db.events.map(async event => {
         const policySnapshot = {
           optedOut: event.optedOut || false,
           attempts: event.attempts || 0,
           contacts: event.contacts || 0
         };
  
         const recoveryContext = {
           // Original payment attempts.
           attemptCount: Number(event.attempts || 0),
        
           // Recovery attempts are tracked separately.
           recoveryAttemptCount: 0,
           maxRecoveryAttempts: 2,
        
           policySnapshot,
           orderValid: true
         };
  
         let ai;
  
         try {
           ai = await analyseWithAI({
             event,
             incidents: db.incidents,
             recovery: recoveryContext
           });
         } catch (error) {
           console.error(
             `AI analysis failed for ${event.id}:`,
             error.message
           );
  
           // Safe fallback: never automatically act if AI fails
           ai = {
             cause: 'AI analysis unavailable',
             intervention: 'Escalate to human review',
             decision: 'escalate',
             confidence: 0,
             reasoning:
               'The AI agent could not safely complete the analysis.',
             evidence: [
               `AI error: ${error.message}`
             ]
           };
         }
  
         // ------------------------------------------------
         // SERVER-SIDE STATUS MAPPING
         // The LLM recommends. The server controls workflow.
         // ------------------------------------------------
  
         // AI supplies diagnosis/evidence only. Routing below is fully deterministic.
         const status = 'HUMAN_REVIEW';
         const baseRecovery = {
           id: `rec_${createHash('sha1')
             .update(event.id)
             .digest('hex')
             .slice(0, 12)}`,
  
           orderId: event.id,
           customerId: event.customer,
           userId: event.userId || `USR-${String(event.id).replace(/\D/g, '')}`,
           customerName: customerNameFor({ userId: event.userId || `USR-${String(event.id).replace(/\D/g, '')}`, event }),
           amount: event.amount,
  
           // AI output
           cause: ai.cause,
           action: ai.intervention,
           evidence: ai.evidence,
           aiDecision: ai.decision,
           confidence: ai.confidence,
           reasoning: ai.reasoning,
  
           // Server-controlled workflow status
           status,
  
           policySnapshot,
  
           // RecoveryTwin bounded recovery lifecycle
           // Original payment attempts before Revive intervened.
           attemptCount: Number(event.attempts || 0),


           // Fresh recovery links created by Revive.
           recoveryAttemptCount: 0,
           maxRecoveryAttempts: 2,


           lastAttemptAt: null,
           expiredAt: null,
           recoveredAt: null,
           recoveredAmount: null,
           paymentConfirmation: null,
  
           escalationReason: null,
           stoppedAt: null,
  
           orderValid: true,
           paymentLink: null,
           scheduledFor: null,
           customerFeedback: null,
           recoveryToken: randomBytes(18).toString('base64url'),
           recoveryUrl: null,
           event
         };
         // The AI diagnoses the case; this deterministic mapping owns the recommendation.
         // A hard policy block changes only the executable status, never that recommendation.
         let intervention;


if (hardStopReason(baseRecovery)) {
 intervention = INTERVENTIONS.STOP_RECOVERY;


 Object.assign(baseRecovery, {
   intervention,
   ...workflowFor(intervention, event)
 });


 stopForPolicy(baseRecovery, db.incidents);


} else {
 intervention = normalInterventionFor(event, db.incidents);


 Object.assign(baseRecovery, {
   intervention,
   ...workflowFor(intervention, event)
 });
}


// /customer is the only customer-facing workflow.
// Keep recoveryToken for backward compatibility, but do not
// generate or expose /recover/:token URLs.
baseRecovery.recoveryUrl = null;


if (intervention === INTERVENTIONS.WAIT_AND_RETRY_AFTER_RESOLUTION) {
 baseRecovery.evidence = [
   ...(baseRecovery.evidence || []),
   'Matching active technical incident; customer will be contacted after resolution'
 ];
}


if (intervention === INTERVENTIONS.WAIT_AND_RETRY_AFTER_RESOLUTION) {
 notifyCustomer(
   baseRecovery,
   "We're aware of a temporary payment issue. We'll let you know once it's resolved and send you a new payment link."
 );
}


return baseRecovery;
       })
     );
  
     log(
       db,
       `AI Recovery Agent analysed ${db.events.length} payment events.`
     );
  
     if (
       db.incidents.some(
         incident => incident.type === 'issuer_degradation'
       )
     ) {
       log(
         db,
         'Batch-level issuer degradation detected; affected recovery workflows are bounded by server-side policy.'
       );
     }
  
     await save(db);
  
     return respond(res, 200, state(db));
   }
   // Token recovery APIs are retired; /customer is the single active customer flow.
   if (req.method === 'POST' && url.pathname === '/api/customer/login') {
     const { userId } = await json(req);
     if (typeof userId !== 'string' || !db.recoveries.some(item => item.userId === userId)) return respond(res, 401, { error: 'Use a demo User ID from the recovery batch, for example USR-1025.' });
     return respond(res, 200, customerPortalState(db, userId));
   }
   const customerStateMatch = url.pathname.match(/^\/api\/customer\/([^/]+)$/);
   if (customerStateMatch && req.method === 'GET') {
     const userId = decodeURIComponent(customerStateMatch[1]);
     if (!db.recoveries.some(item => item.userId === userId)) return respond(res, 404, { error: 'Customer not found' });
     return respond(res, 200, customerPortalState(db, userId));
   }
   const customerActionMatch = url.pathname.match(
     /^\/api\/customer\/([^/]+)\/recoveries\/([^/]+)\/(schedule|feedback|continue|confirm)$/
   );
  
   if (customerActionMatch && req.method === 'POST') {
     const [, encodedUserId, recoveryId, action] = customerActionMatch;
  
     const userId = decodeURIComponent(encodedUserId);
  
     const recovery = db.recoveries.find(
       item =>
         item.id === recoveryId &&
         item.userId === userId
     );
  
     if (!recovery) {
       return respond(res, 404, {
         error: 'Recovery not found for this customer'
       });
     }
  
     const input = await json(req);
  
     // Never allow customer actions after a real hard stop.
     const hardStop = hardPolicyStatus(recovery);
  
     if (hardStop === 'STOPPED') {
       return respond(res, 409, {
         error: 'Recovery action is no longer allowed by policy'
       });
     }
  
     if (hardStop === 'RECOVERED') {
       return respond(res, 409, {
         error: 'This payment has already been recovered'
       });
     }
  
     // =====================================================
     // SCHEDULE PAYMENT
     // =====================================================
     if (action === 'schedule') {
       if (recovery.status !== 'AWAITING_SCHEDULE') {
         return respond(res, 409, {
           error: 'This recovery is not currently awaiting a schedule'
         });
       }
  
       if (typeof input.scheduledFor !== 'string') {
         return respond(res, 400, {
           error: 'Choose a payment date and time'
         });
       }
  
       const when = new Date(input.scheduledFor);
  
       if (
         Number.isNaN(when.getTime()) ||
         when.getTime() <= Date.now()
       ) {
         return respond(res, 400, {
           error: 'Choose a future payment date and time'
         });
       }
  
       recovery.status = 'SCHEDULED';
       recovery.scheduledFor = when.toISOString();
  
       notifyCustomer(
         recovery,
         `Payment recovery scheduled for ${when.toLocaleString()}.`
       );
  
       log(
         db,
         `${recovery.userId}: customer scheduled payment recovery for ${when.toLocaleString()}.`,
         recovery.id
       );
  
       await save(db);
  
       return respond(
         res,
         200,
         customerPortalState(db, userId)
       );
     }
  
     // =====================================================
     // CREATE NEW PAYMENT LINK
     // =====================================================
     if (action === 'continue') {
       if (recovery.status !== 'READY_TO_GENERATE_LINK') {
         return respond(res, 409, {
           error: 'A new payment link cannot be created for this case'
         });
       }
  
       // createRecoveryLinkOnce must prevent duplicate links.
       const outcome = await createRecoveryLinkOnce(
         db,
         recovery,
         'customer_continue'
       );
  
       if (!outcome?.ok) {
         return respond(res, 409, {
           error:
             outcome?.error ||
             'A payment link could not be created'
         });
       }
       await save(db);
  
       return respond(
         res,
         200,
         customerPortalState(db, userId)
       );
     }


     // =====================================================
     // CONFIRM AFTER A RESOLVED BANK / TECHNICAL INCIDENT
     // =====================================================
     if (action === 'confirm') {
       if (recovery.status !== 'AWAITING_CUSTOMER_CONFIRMATION') {
         return respond(res, 409, { error: 'This recovery is not awaiting customer confirmation' });
       }
       if (!['yes', 'no'].includes(input.choice)) {
         return respond(res, 400, { error: 'Choose Yes or No' });
       }
       if (input.choice === 'no') {
         recovery.customerFeedback = { reason: 'changed_mind', submittedAt: new Date().toISOString() };
         recovery.stopReason = 'CUSTOMER_CHANGED_MIND';
         Object.assign(recovery, { intervention: INTERVENTIONS.STOP_RECOVERY, ...getWorkflowFor(INTERVENTIONS.STOP_RECOVERY, recovery.event) });
         log(db, `${recovery.userId}: chose not to continue after incident resolution.`, recovery.id);
         await save(db);
         return respond(res, 200, customerPortalState(db, userId));
       }
       recovery.intervention = INTERVENTIONS.GENERATE_AND_SEND_NEW_LINK;
       recovery.status = 'READY_TO_GENERATE_LINK';
       recovery.action = 'Customer confirmed payment after incident resolution';
       await save(db);
       const outcome = await createRecoveryLinkOnce(db, recovery, 'incident_confirmation');
       if (!outcome.ok) return respond(res, 409, { error: outcome.error || 'Payment link could not be created' });
       return respond(res, 200, customerPortalState(db, userId));
     }
  
     // =====================================================
     // CUSTOMER FEEDBACK
     // =====================================================
     if (action === 'feedback') {
       if (recovery.status !== 'AWAITING_CUSTOMER_RESPONSE') {
         return respond(res, 409, {
           error:
             'Customer feedback has already been processed for this recovery'
         });
       }
  
       const reason = input.reason;
  
       if (!FEEDBACK_REASONS.has(reason)) {
         return respond(res, 400, {
           error: 'Select a valid reason'
         });
       }
  
       // Payment method issue requires all structured fields.
       if (
         reason === 'payment_method_issue' ||
         reason === 'payment_method_unavailable'
       ) {
         const requiredFields = [
           'paymentMethod',
           'preferredProvider',
           'whatHappened'
         ];
  
         const invalidField = requiredFields.some(field => {
           const value = input[field];
  
           return (
             typeof value !== 'string' ||
             !value.trim() ||
             value.length > 20
           );
         });
  
         if (invalidField) {
           return respond(res, 400, {
             error:
               'Each payment-method field is required and limited to 20 characters'
           });
         }
       }
  
       // Save the customer's choice FIRST.
       recovery.customerFeedback = {
         reason,
  
         note:
           typeof input.note === 'string'
             ? input.note.slice(0, 500).trim()
             : '',
  
         paymentMethod:
           typeof input.paymentMethod === 'string'
             ? input.paymentMethod.trim().slice(0, 20)
             : '',
  
         preferredProvider:
           typeof input.preferredProvider === 'string'
             ? input.preferredProvider.trim().slice(0, 20)
             : '',
  
         whatHappened:
           typeof input.whatHappened === 'string'
             ? input.whatHappened.trim().slice(0, 20)
             : '',
  
         submittedAt: new Date().toISOString()
       };
  
       // Decide the new workflow state.
       const decision = applyCustomerFeedbackDecision(
         recovery,
         recovery.event,
         db.incidents
       );
  
       Object.assign(recovery, decision);
  
       log(
         db,
         `${recovery.orderId}: customer selected ${reason}; ` +
         `workflow changed to ${recovery.status}.`,
         recovery.id
       );
  
       // IMPORTANT:
       // Save the new status BEFORE doing anything slow.
       // This prevents a second click/request from seeing
       // AWAITING_CUSTOMER_RESPONSE and reopening the popup.
       await save(db);
  
       recovery.evidence = [
         ...new Set([
           ...(recovery.evidence || []),
           `Customer feedback: ${reason}`
         ])
       ];
  
       // "I still want to continue"
       // Generate exactly one fresh link.
       if (decision.status === 'READY_TO_GENERATE_LINK') {
         const outcome = await createRecoveryLinkOnce(
           db,
           recovery,
           'customer_continue'
         );
  
         if (!outcome?.ok && !outcome.rateLimited) {
           recovery.status = 'READY_TO_GENERATE_LINK';
        
           recovery.intervention =
             INTERVENTIONS.GENERATE_AND_SEND_NEW_LINK;
        
           recovery.action =
             'Payment link generation failed; retry is required';
        
           recovery.evidence.push(
             'Automatic payment link creation failed'
           );
        
           log(
             db,
             `${recovery.orderId}: automatic link creation failed; recovery remains active.`,
             recovery.id
           );
         }
        
         if (outcome?.rateLimited) {
           recovery.status = 'READY_TO_GENERATE_LINK';
           recovery.intervention =
             INTERVENTIONS.GENERATE_AND_SEND_NEW_LINK;
         }
       }
  
       await save(db);
  
       // Return the NEW backend state.
       // The frontend must render this response instead of
       // reopening the old popup.
       return respond(
         res,
         200,
         customerPortalState(db, userId)
       );
     }
  
     return respond(res, 400, {
       error: 'Unknown customer action'
     });
   }
   const resolveMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/resolve$/);
   if (resolveMatch && req.method === 'POST') {
     const incident = db.incidents.find(item => item.id === resolveMatch[1]);
     if (!incident) return respond(res, 404, { error: 'Incident not found' });
     incident.status = 'resolved'; incident.resolvedAt = new Date().toISOString();
     let confirmationsAwaiting = 0;
     for (const recovery of db.recoveries.filter(item => ['WAITING_FOR_BANK_RESOLUTION', 'WAITING_FOR_TECHNICAL_RESOLUTION'].includes(item.status))) {
       const hardStop = hardPolicyStatus(recovery);
       if (hardStop) { stopForPolicy(recovery, db.incidents); log(db, `${recovery.orderId}: incident resolved but policy recheck stopped recovery — ${recovery.stopReason}.`, recovery.id); continue; }
       if (hasMatchingIncident(recovery.event, db.incidents)) continue;
       recovery.status = 'AWAITING_CUSTOMER_CONFIRMATION';
       recovery.intervention = INTERVENTIONS.WAIT_AND_RETRY_AFTER_RESOLUTION;
       recovery.action = 'Ask customer to confirm payment after incident resolution';
       notifyCustomer(recovery, 'The payment issue is resolved. Please confirm whether you would like to complete your payment.');
       log(db, `${recovery.userId}: incident resolved; awaiting customer confirmation before creating a link.`, recovery.id);
       confirmationsAwaiting++;
     }
     log(db, `${incident.title}: marked resolved; ${confirmationsAwaiting} customers asked for confirmation.`);
     await save(db); return respond(res, 200, { state: state(db), confirmationsAwaiting });
   }
   if (req.method === 'POST' && url.pathname === '/api/razorpay/webhook') {
     const payload = await rawBody(req);
     const signature = req.headers['x-razorpay-signature'];
  
     if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
       return respond(res, 503, {
         error: 'Webhook secret is not configured'
       });
     }
  
     if (!validWebhookSignature(payload, signature)) {
       log(db, 'Rejected Razorpay webhook: invalid signature.');
       await save(db);
  
       return respond(res, 400, {
         error: 'Invalid webhook signature'
       });
     }
  
     const event = JSON.parse(payload);
     const linkId = event?.payload?.payment_link?.entity?.id;
  
     if (
       !['payment_link.paid', 'payment_link.expired'].includes(event.event) ||
       !linkId
     ) {
       return respond(res, 200, {
         received: true,
         action: 'ignored'
       });
     }
  
     const recovery = db.recoveries.find(
       item => item.paymentLink?.id === linkId
     );
  
     if (!recovery) {
       log(
         db,
         `Verified Razorpay webhook received for unknown link ${linkId}.`
       );
       await save(db);
  
       return respond(res, 200, {
         received: true,
         action: 'unknown_link'
       });
     }
  
     if (event.event === 'payment_link.paid') {
       if (['recovered', 'RECOVERED'].includes(recovery.status)) {
         return respond(res, 200, {
           received: true,
           action: 'already_recovered',
           recoveryId: recovery.id
         });
       }
  
       const paidInPaise = Number(event?.payload?.payment_link?.entity?.amount_paid ?? event?.payload?.payment?.entity?.amount);
       const recoveredAmount = Number.isFinite(paidInPaise) && paidInPaise > 0
         ? paidInPaise / 100
         : Number(recovery.amount || 0);


       recovery.status = 'RECOVERED';
       recovery.recoveredAt = new Date().toISOString();
       recovery.recoveredAmount = recoveredAmount;
       recovery.paymentConfirmation = {
         eventId: event?.payload?.payment?.entity?.id || event?.payload?.payment_link?.entity?.id || linkId,
         linkId,
         confirmedAt: recovery.recoveredAt
       };
  
       log(db, `${recovery.userId}: Payment completed successfully. ₹${recoveredAmount.toLocaleString('en-IN')} recovered.`, recovery.id);
  
       await save(db);
  
       return respond(res, 200, {
         received: true,
         action: 'recovery_marked_paid',
         recoveryId: recovery.id,
         recoveredAmount,
         metrics: state(db).metrics
       });
     }
  
   // payment_link.expired
 if (['recovered', 'RECOVERED'].includes(recovery.status)) {
   return respond(res, 200, {
   received: true,
   action: 'ignored_already_recovered',
   recoveryId: recovery.id
 });
 }


 recovery.expiredAt = new Date().toISOString();
 recovery.paymentLink = null;
 const policyStop = hardPolicyStatus(recovery);
 if (policyStop) {
   stopForPolicy(recovery, db.incidents);
   log(db, `${recovery.orderId}: expired payment link stopped by policy recheck — ${recovery.stopReason}.`, recovery.id);
 } else {
   Object.assign(recovery, { intervention: INTERVENTIONS.HUMAN_REVIEW, ...workflowFor(INTERVENTIONS.HUMAN_REVIEW) });
   log(db, `${recovery.orderId}: payment link expired; sent for human review.`, recovery.id);
 }


 await save(db);


 return respond(res, 200, {
   received: true,
   action: recovery.status,
   recoveryId: recovery.id
 });
 } // <-- ADD THIS: closes /api/razorpay/webhook
    // The User ID portal is the only active customer workflow.
   if (req.method === 'GET' && /^\/recover\/[^/]+$/.test(url.pathname)) { res.writeHead(302, { location: '/customer' }); return res.end(); }
   if (req.method === 'GET' && url.pathname === '/customer') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(await readFile(path.join(root, 'customer.html'))); }
   if (req.method === 'GET') { const file = path.resolve(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1)); if (!file.startsWith(root)) return respond(res, 403, { error: 'Forbidden' }); try { if (!(await stat(file)).isFile()) throw Error(); res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); return res.end(await readFile(file)); } catch { return respond(res, 404, { error: 'Not found' }); } }
   return respond(res, 405, { error: 'Method not allowed' });
 } catch (error) { console.error(error); return respond(res, 500, { error: error.message }); }
}).listen(port, '127.0.0.1', () => console.log(`Revive AI server: http://localhost:${port}`));
setInterval(() => processDueRecoveries().catch(console.error), 60_000).unref();

