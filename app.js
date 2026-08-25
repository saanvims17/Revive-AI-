const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const state = {
  events: [],
  decisions: [],
  audit: [],
  backendLoaded: false
};

function seedEvents() {
  const events = [];
  const failureCodes = ['bank_error', 'checkout_timeout', 'insufficient_funds', 'abandoned', 'declined'];
  for (let i = 1; i <= 100; i++) {
    const code = failureCodes[(i * 7) % failureCodes.length];
    events.push({
      id: `ORD-${String(1000 + i)}`, customer: `CUS-${String(200 + i)}`,
      amount: 700 + ((i * 467) % 8700), status: code === 'abandoned' ? 'abandoned' : 'failed',
      failureCode: code, issuer: i <= 24 ? 'Northstar Bank' : ['Meridian Bank', 'Union Bank', 'ClearPay'][i % 3],
      checkoutVersion: i >= 50 && i <= 61 ? 'v2.7.1' : 'v2.6.4',
      attempts: i % 12 === 0 ? 2 : 1, contacts: i % 14 === 0 ? 1 : 0,
      optedOut: i % 31 === 0, time: `10:${String((i * 3) % 60).padStart(2, '0')}`
    });
  }
  return events;
}

function actionFor(event, incidents) {
  const blocked = event.optedOut || event.attempts >= 2 || event.contacts >= 1;
  if (blocked) return { cause: 'Recovery suppressed', action: 'Stop automation; merchant review only', status: 'suppressed', evidence: event.optedOut ? 'Customer opted out' : 'Retry/contact limit reached' };
  if (event.issuer === 'Northstar Bank' && event.failureCode === 'bank_error') return { cause: 'Issuer degradation', action: 'Wait; offer alternate method after incident clears', status: 'suppressed', evidence: '24 bank errors in a 15-minute window' };
  if (event.checkoutVersion === 'v2.7.1' && event.failureCode === 'checkout_timeout') return { cause: 'Merchant checkout degradation', action: 'Create incident; pause customer outreach', status: 'suppressed', evidence: 'Checkout timeouts spike on v2.7.1' };
  if (event.failureCode === 'abandoned') return { cause: 'Checkout abandonment', action: 'Create 30-minute payment link', status: 'approve', evidence: 'Checkout started; no payment attempt' };
  if (event.failureCode === 'insufficient_funds' || event.failureCode === 'declined') return { cause: 'Likely insufficient funds', action: 'Offer customer-chosen payment schedule', status: 'schedule', evidence: 'No platform-wide incident; safe contact window' };
  return { cause: 'Uncertain temporary failure', action: 'Hold for merchant review', status: 'suppressed', evidence: 'Insufficient evidence for safe automation' };
}

function audit(message) {
  state.audit.unshift({ message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  document.getElementById('auditList').innerHTML = state.audit.map(item => `<li><time>${item.time}</time>${item.message}</li>`).join('');
}

function renderBackend(payload) {
  state.backendLoaded = true;
  state.events = Array.from({ length: payload.metrics.events });
  state.decisions = payload.recoveries.map(recovery => ({
    ...recovery,
    event: { id: recovery.orderId, amount: recovery.amount },
    status: recovery.status
  }));
  document.getElementById('eventsMetric').textContent = payload.metrics.events;

  document.getElementById('eventsSub').textContent = `${payload.metrics.events}-event recovery batch`;

  document.getElementById('riskMetric').textContent = money.format(payload.metrics.currentAtRisk);

  document.getElementById('riskSub').textContent = `Total revenue at risk before recovery: ${money.format(payload.metrics.initialAtRisk)}`;

  document.getElementById('actionMetric').textContent = money.format(payload.metrics.recovered);

  document.getElementById('actionSub').textContent = 'Verified successful payments';

  document.getElementById('protectedMetric').textContent = `${payload.metrics.protectedCount} cases`;
  
  document.getElementById('incidentState').className = 'tag active';
  document.getElementById('incidentState').textContent = `${payload.incidents.length} incidents detected`;
  document.getElementById('incidentList').innerHTML = payload.incidents.map(incident => `<div class="incident"><strong>${incident.title}</strong><p>${incident.detail}</p>${incident.status === 'active' ? `<button class="resolve-incident" data-id="${incident.id}">Mark resolved</button>` : '<small>Resolved</small>'}</div>`).join('');
  document.querySelectorAll('.resolve-incident').forEach(button => button.addEventListener('click', async () => {
    const response = await fetch(`/api/incidents/${button.dataset.id}/resolve`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) return audit(`Incident resolution blocked — ${result.error}`);
    renderBackend(result.state);
  }));
  state.audit = payload.audit.map(item => ({ message: item.message, time: new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
  document.getElementById('auditList').innerHTML = state.audit.map(item => `<li><time>${item.time}</time>${item.message}</li>`).join('');
  document.getElementById('agentNarrative').textContent = `Detected ${payload.incidents.length} payment incidents. ${payload.metrics.actionableCount} recoveries are policy-safe; ${payload.metrics.protectedCount} customers are protected from bad outreach.`;
  renderQueue();
}

function renderIncidents() {
  document.getElementById('incidentState').className = 'tag active';
  document.getElementById('incidentState').textContent = '2 incidents detected';
  document.getElementById('incidentList').innerHTML = `
    <div class="incident"><strong>Issuer degradation · Northstar Bank</strong><p>24 <code>bank_error</code> events in 15 minutes. Customer recovery is suppressed until this incident clears.</p></div>
    <div class="incident"><strong>Checkout degradation · version v2.7.1</strong><p>12 checkout timeouts detected after release. Merchant incident opened; no customer outreach authorised.</p></div>`;
}

function renderQueue() {
  const body = document.getElementById('queueBody');
  body.innerHTML = '';

  const top = state.decisions
    .filter(d => d.status !== 'STOPPED')
    .sort((a, b) => b.event.amount - a.event.amount)
    .slice(0, 8);

  const blocked = state.decisions
    .filter(d => d.status === 'STOPPED')
    .slice(0, 3);

  const decisionsToShow = [...top, ...blocked];

  if (!decisionsToShow.length) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="empty-cell">
          No recovery recommendations yet.
        </td>
      </tr>
    `;
    return;
  }

  decisionsToShow.forEach(d => {
    const node = document
      .getElementById('queueRowTemplate')
      .content
      .cloneNode(true);

    node.querySelector('.order').textContent = d.event.id;
    node.querySelector('.user-id').textContent = d.userId || '—';
    node.querySelector('.amount').textContent = money.format(d.event.amount);
    node.querySelector('.cause').textContent = d.cause;
    node.querySelector('.action').textContent = d.action || d.intervention || '—';
    node.querySelector('.decision').textContent = d.status === 'RECOVERED'
      ? 'Recovered'
      : d.status === 'STOPPED'
        ? `Stopped — ${d.stopReason || 'hard policy applied'}`
        : d.status.replaceAll('_', ' ');

    body.append(node);
  });
}

async function analyse() {
  try {
    const response = await fetch('/api/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Backend unavailable');
    renderBackend(await response.json());
    document.getElementById('analyzeBtn').textContent='Batch analysed ✓'; document.getElementById('analyzeBtn').disabled=true;
    return;
  } catch (error) {
    console.warn('Backend analysis failed:', error);
    audit('Backend analysis is unavailable. No local fallback data is shown.');
  }
}

async function refreshState() {
  if (!state.backendLoaded) return;

  try {
    const response = await fetch('/api/state');

    if (!response.ok) return;

    const payload = await response.json();
    renderBackend(payload);
  } catch (error) {
    console.warn('State refresh failed:', error);
  }
}
document.getElementById('analyzeBtn').addEventListener('click', analyse);
// Keep the UI synchronized with webhook updates from Razorpay
setInterval(refreshState, 1000);
