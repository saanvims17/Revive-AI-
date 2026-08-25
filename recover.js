const token = location.pathname.split('/').pop();
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const loading = document.querySelector('#loading'), content = document.querySelector('#content'), complete = document.querySelector('#complete'), errorBox = document.querySelector('#error');
async function loadRecovery() {
  
  const response = await fetch(`/api/recover/${encodeURIComponent(token)}`), data = await response.json();
  if (!response.ok) throw new Error(data.error || 'This payment recovery page is unavailable.');
  loading.hidden = true;
  if (data.paymentLink?.shortUrl) 
  { 
  complete.hidden = false; document.querySelector('#completeTitle').textContent = 'Your secure payment link is ready.'; 
  document.querySelector('#completeMessage').textContent = `Order ${data.orderId} · ${currency.format(data.amount)}`; 
  const link = document.querySelector('#paymentLink'); link.href = data.paymentLink.shortUrl; link.hidden = false; return; 
  }
  
  if (data.feedbackSubmitted || data.status !== 'awaiting_customer_feedback') 
  { 
  complete.hidden = false; document.querySelector('#completeMessage').textContent = data.publicMessage || 'Your response is recorded. We will handle the next step according to the merchant’s payment policy.'; 
    return; 
  }
  
  document.querySelector('#order').textContent = data.orderId; document.querySelector('#amount').textContent = currency.format(data.amount); content.hidden = false;
}
document.querySelector('#feedbackForm').addEventListener('change', event => { document.querySelector('#methodDetails').hidden = new FormData(event.currentTarget).get('reason') !== 'payment_method_issue'; });
document.querySelector('#feedbackForm').addEventListener('submit', async event => {
  event.preventDefault(); errorBox.textContent = ''; const reason = new FormData(event.currentTarget).get('reason'), note = document.querySelector('#note').value;
  const paymentMethod = document.querySelector('#paymentMethod').value, preferredProvider = document.querySelector('#preferredProvider').value, whatHappened = document.querySelector('#whatHappened').value;
  const response = await fetch(`/api/recover/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, note, paymentMethod, preferredProvider, whatHappened }) });
  const data = await response.json(); if (!response.ok) { errorBox.textContent = data.error || 'We could not save your response.'; return; }
  content.hidden = true; complete.hidden = false; document.querySelector('#completeMessage').textContent = data.message;
});
loadRecovery().catch(error => { loading.hidden = true; errorBox.textContent = error.message; });
