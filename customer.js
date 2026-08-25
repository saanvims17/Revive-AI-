const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

let userId = localStorage.getItem('rt_demo_user');
let feedbackSubmitting = false;
let scheduleSubmitting = false;
let confirmationSubmitting = false;
let selectedReason = null;
let loadInProgress = false;

const $ = selector => document.querySelector(selector);

const showError = message => {
  $('#error').textContent = message || '';
};

async function api(url, options = {}) {
  const response = await fetch(url, options);

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function isAwaitingReason(recovery) {
  return (
    recovery.workflowStatus === 'AWAITING_CUSTOMER_RESPONSE' &&
    !recovery.customerResponse
  );
}

function customerStatus(recovery) {
  const workflowStatus = recovery.workflowStatus;

  const statuses = {
    AWAITING_CUSTOMER_RESPONSE: 'Action needed',
    AWAITING_CUSTOMER_CONFIRMATION: 'Confirmation needed',
    WAITING_FOR_BANK_RESOLUTION: 'Temporary bank issue',
    WAITING_FOR_TECHNICAL_RESOLUTION: 'Temporary technical issue',
    AWAITING_SCHEDULE: 'Choose a payment time',
    SCHEDULED: 'Payment scheduled',
    RECOVERY_LINK_READY: 'Payment link ready',
    READY_TO_GENERATE_LINK: 'Preparing your payment link',
    PAYMENT_METHOD_FEEDBACK_COLLECTED: 'Details received',
    RECOVERED: 'Payment completed',
    recovered: 'Payment completed',
    STOPPED: 'Recovery stopped',
    HUMAN_REVIEW: 'Our team is reviewing this'
  };

  return statuses[workflowStatus] || 'Payment update';
}

function card(recovery) {
  const workflowStatus = recovery.workflowStatus;

  const pay = recovery.paymentLink?.shortUrl
    ? `
      <section class="payment-link">
        <strong>Your payment link is ready</strong>
        <p>Here is your secure link to finish your payment.</p>
        <a
          class="pay"
          href="${recovery.paymentLink.shortUrl}"
          target="_blank"
          rel="noopener"
        >
          Click here to pay now
        </a>
      </section>
    `
    : '';

  const scheduler = workflowStatus === 'AWAITING_SCHEDULE'
    ? `
      <form class="schedule" data-id="${recovery.id}">
        <h3>Choose a payment time</h3>

        <input
          name="scheduledFor"
          type="datetime-local"
          required
        >

        <button type="submit">
          Schedule payment
        </button>
      </form>
    `
    : '';

  const confirmation = workflowStatus === 'AWAITING_CUSTOMER_CONFIRMATION'
    ? `<section class="confirmation" data-id="${recovery.id}"><h3>The issue with your bank has been resolved. Would you like to complete your payment?</h3><div><button type="button" data-choice="yes">Yes</button><button type="button" class="quiet" data-choice="no">No</button></div></section>`
    : '';

  const notice =
    workflowStatus === 'WAITING_FOR_BANK_RESOLUTION'
      ? `
        <p class="notice">
          We're aware of a temporary issue affecting your bank.
          You don't need to do anything right now. We'll automatically
          send you a fresh payment link once the issue is resolved.
        </p>
      `
      : workflowStatus === 'WAITING_FOR_TECHNICAL_RESOLUTION'
        ? `
          <p class="notice">
            We're aware of a temporary checkout issue.
            You don't need to do anything right now. We'll automatically
            send you a fresh payment link once it is resolved.
          </p>
        `
        : workflowStatus === 'RECOVERED'
          ? `
            <p class="notice success">
              Payment completed successfully.
            </p>
          `
          : workflowStatus === 'STOPPED'
            ? `
              <p class="notice">
                No further payment recovery attempts will be made
                for this order.
              </p>
            `
            : workflowStatus === 'PAYMENT_METHOD_FEEDBACK_COLLECTED'
              ? `
                <p class="notice">
                  Thanks. We have recorded the payment-method issue
                  for our team to review.
                </p>
              `
              : workflowStatus === 'SCHEDULED'
                ? `
                  <p class="notice">
                    Your payment time is scheduled. We will send a fresh
                    secure link at that time.
                  </p>
                `
                : workflowStatus === 'HUMAN_REVIEW'
                  ? `
                    <p class="notice">
                      Thanks for letting us know. Our team will review
                      the issue and someone will get in touch with you
                      to help resolve it.
                    </p>
                  `
                  : '';

  return `
    <article>
      <div class="payment-details">
        <div>
          <span>Order ID</span>
          <strong>${recovery.orderId}</strong>
        </div>

        <div>
          <span>Amount to be paid</span>
          <strong>${money.format(recovery.amount)}</strong>
        </div>

        <div>
          <span>Current payment status</span>
          <strong>${customerStatus(recovery)}</strong>
        </div>
      </div>

      ${notice}
      ${pay}
      ${scheduler}
      ${confirmation}
    </article>
  `;
}

function modalForm(recovery) {
  return `
    <form id="reasonForm" data-id="${recovery.id}">
      <h2 id="reasonTitle">
        Why weren't you able to complete your payment?
      </h2>

      <div class="choices">
        <button
          type="button"
          data-reason="need_more_time"
        >
          Insufficient funds / Need more time
        </button>

        <button
          type="button"
          data-reason="bank_issue"
        >
          My bank has a payment issue
        </button>

        <button
          type="button"
          data-reason="technical_problem"
        >
          I had a technical issue
        </button>

        <button
          type="button"
          data-reason="payment_method_issue"
        >
          Payment method unavailable
        </button>

        <button
          type="button"
          data-reason="continue"
        >
          I still want to continue
        </button>

        <button
          type="button"
          data-reason="changed_mind"
        >
          I changed my mind
        </button>
      </div>

      <input
        type="hidden"
        name="reason"
      >

      <div class="method" hidden>
        <label>
          Preferred payment method

          <input
            name="paymentMethod"
            maxlength="20"
            autocomplete="off"
          >

          <small>0/20</small>
        </label>

        <label>
          Preferred bank/provider

          <input
            name="preferredProvider"
            maxlength="20"
            autocomplete="off"
          >

          <small>0/20</small>
        </label>

        <label>
          What happened

          <input
            name="whatHappened"
            maxlength="20"
            autocomplete="off"
          >

          <small>0/20</small>
        </label>
      </div>

      <div class="technical" hidden>
        <label>
          What went wrong?

          <textarea
            name="note"
            maxlength="500"
            placeholder="Optional description"
          ></textarea>
        </label>
      </div>

      <button
        type="submit"
        class="submit-details"
        hidden
      >
        Submit details
      </button>

      <p id="modalError" class="modal-error"></p>
    </form>
  `;
}

function closeReasonModal() {
  const modal = $('#reasonModal');

  modal.hidden = true;
  modal.dataset.recoveryId = '';

  $('#reasonContent').innerHTML = '';

  selectedReason = null;
}

function openReasonModal(recovery) {
  const modal = $('#reasonModal');

  if (!isAwaitingReason(recovery)) {
    closeReasonModal();
    return;
  }

  // Never rebuild the same modal while the customer
  // is already interacting with it.
  if (
    !modal.hidden &&
    modal.dataset.recoveryId === recovery.id
  ) {
    return;
  }

  // Never interrupt a request.
  if (feedbackSubmitting) {
    return;
  }

  selectedReason = null;

  modal.dataset.recoveryId = recovery.id;
  $('#reasonContent').innerHTML = modalForm(recovery);
  modal.hidden = false;

  const form = $('#reasonForm');

  const method = form.querySelector('.method');
  const technical = form.querySelector('.technical');
  const submit = form.querySelector('.submit-details');

  form.querySelectorAll('[data-reason]').forEach(button => {
    button.addEventListener('click', async () => {
      if (feedbackSubmitting) return;

      const reason = button.dataset.reason;

      selectedReason = reason;
      form.elements.reason.value = reason;

      // Reset optional sections.
      method.hidden = true;
      technical.hidden = true;
      submit.hidden = true;

      // Payment method issue requires details.
      if (reason === 'payment_method_issue') {
        method.hidden = false;
        submit.hidden = false;

        form
          .querySelector('input[name="paymentMethod"]')
          .focus();

        return;
      }

      // All other choices are immediately submitted once.
      await submitReason(form);
    });
  });

  form
    .querySelectorAll('.method input')
    .forEach(input => {
      input.addEventListener('input', () => {
        const counter = input.nextElementSibling;

        if (counter) {
          counter.textContent =
            `${input.value.length}/20`;
        }
      });
    });

  form.addEventListener('submit', async event => {
    event.preventDefault();

    if (
      feedbackSubmitting ||
      selectedReason !== 'payment_method_issue'
    ) {
      return;
    }

    await submitReason(form);
  });
}

async function submitReason(form) {
  if (feedbackSubmitting) return;

  const reason = form.elements.reason.value;
  const modalError = form.querySelector('#modalError');

  if (modalError) modalError.textContent = '';

  if (!reason) {
    if (modalError) modalError.textContent = 'Please select an option.';
    else showError('Please select an option.');
    return;
  }

  // Capture the enabled form values before disabling controls. Disabled fields are
  // intentionally omitted by FormData, including the hidden selected reason.
  const payload = Object.fromEntries(new FormData(form));

  feedbackSubmitting = true;
  showError('');

  form
    .querySelectorAll('button, input, textarea')
    .forEach(element => {
      element.disabled = true;
    });

  try {
    const updatedState = await api(
      `/api/customer/${encodeURIComponent(userId)}/recoveries/${form.dataset.id}/feedback`,
      {
        method: 'POST',

        headers: {
          'content-type': 'application/json'
        },

        body: JSON.stringify(payload)
      }
    );

    // IMPORTANT:
    // Close immediately after the backend confirms
    // the workflow state was changed.
    closeReasonModal();

    feedbackSubmitting = false;

    // Render the state returned by the backend first.
    renderCustomerState(updatedState);

  } catch (error) {
    feedbackSubmitting = false;

    form
      .querySelectorAll('button, input, textarea')
      .forEach(element => {
        element.disabled = false;
      });

    if (modalError) {
      modalError.textContent = error.message;
    } else {
      showError(error.message);
    }
  }
}

function bindScheduler() {
  document.querySelectorAll('.schedule').forEach(form => {
    const input = form.querySelector(
      '[name="scheduledFor"]'
    );

    // Local datetime-local format.
    const minimum = new Date();

    minimum.setMinutes(
      minimum.getMinutes() + 1
    );

    minimum.setSeconds(0, 0);

    const pad = value =>
      String(value).padStart(2, '0');

    const minValue =
      `${minimum.getFullYear()}-` +
      `${pad(minimum.getMonth() + 1)}-` +
      `${pad(minimum.getDate())}T` +
      `${pad(minimum.getHours())}:` +
      `${pad(minimum.getMinutes())}`;

    input.min = minValue;

    form.addEventListener('submit', async event => {
      event.preventDefault();

      if (scheduleSubmitting) return;

      if (!input.value) {
        showError(
          'Please select both a payment date and time.'
        );

        return;
      }

      const selectedTime = new Date(input.value);

      if (
        Number.isNaN(selectedTime.getTime()) ||
        selectedTime.getTime() <= Date.now()
      ) {
        showError(
          'Please select a future payment date and time.'
        );

        return;
      }

      scheduleSubmitting = true;
      showError('');

      const submitButton =
        form.querySelector(
          'button[type="submit"]'
        );

      input.disabled = true;

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Scheduling...';
      }

      try {
        const updatedState = await api(
          `/api/customer/${encodeURIComponent(userId)}/recoveries/${form.dataset.id}/schedule`,
          {
            method: 'POST',

            headers: {
              'content-type': 'application/json'
            },

            body: JSON.stringify({
              scheduledFor: input.value
            })
          }
        );

        scheduleSubmitting = false;

        // Render the exact new backend state.
        renderCustomerState(updatedState);

      } catch (error) {
        scheduleSubmitting = false;

        input.disabled = false;

        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent =
            'Schedule payment';
        }

        showError(error.message);
      }
    });
  });
}

function bindConfirmations() {
  document.querySelectorAll('.confirmation').forEach(panel => {
    panel.querySelectorAll('[data-choice]').forEach(button => {
      button.addEventListener('click', async () => {
        if (confirmationSubmitting) return;
        confirmationSubmitting = true;
        panel.querySelectorAll('button').forEach(item => { item.disabled = true; });
        try {
          const updatedState = await api(`/api/customer/${encodeURIComponent(userId)}/recoveries/${panel.dataset.id}/confirm`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ choice: button.dataset.choice })
          });
          confirmationSubmitting = false;
          renderCustomerState(updatedState);
        } catch (error) {
          confirmationSubmitting = false;
          panel.querySelectorAll('button').forEach(item => { item.disabled = false; });
          showError(error.message);
        }
      });
    });
  });
}

function renderCustomerState(data) {
  if (!data || !userId) return;

  $('#login').hidden = true;
  $('#portal').hidden = false;

  $('#customerGreeting').textContent =
    `Hi, ${data.recoveries[0]?.customerName || 'there'} 👋`;

  $('#cards').innerHTML =
    data.recoveries.map(card).join('') ||
    '<p>No payment recoveries found.</p>';

  bindScheduler();
  bindConfirmations();

  // Do not reopen/rebuild the modal while submitting.
  if (!feedbackSubmitting) {
    const awaiting =
      data.recoveries.find(isAwaitingReason);

    if (awaiting) {
      openReasonModal(awaiting);
    } else {
      closeReasonModal();
    }
  }
}

async function load() {
  if (!userId) return;

  // Prevent overlapping polling requests.
  if (loadInProgress) return;

  // Do not poll while the customer is submitting feedback
  // or choosing/submitting a schedule.
  if (
    feedbackSubmitting ||
    scheduleSubmitting ||
    confirmationSubmitting
  ) {
    return;
  }

  loadInProgress = true;

  try {
    const data = await api(
      `/api/customer/${encodeURIComponent(userId)}`
    );

    renderCustomerState(data);

    showError('');

  } catch (error) {
    localStorage.removeItem('rt_demo_user');

    userId = null;

    closeReasonModal();

    $('#portal').hidden = true;
    $('#login').hidden = false;

    showError(error.message);

  } finally {
    loadInProgress = false;
  }
}

$('#loginForm').addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    try {
      showError('');

      const data = await api(
        '/api/customer/login',
        {
          method: 'POST',

          headers: {
            'content-type': 'application/json'
          },

          body: JSON.stringify({
            userId:
              $('#customerId').value.trim()
          })
        }
      );

      userId = data.userId;

      localStorage.setItem(
        'rt_demo_user',
        userId
      );

      await load();

    } catch (error) {
      showError(error.message);
    }
  }
);

$('#logout').addEventListener(
  'click',
  () => {
    localStorage.removeItem('rt_demo_user');

    userId = null;

    feedbackSubmitting = false;
    scheduleSubmitting = false;
    loadInProgress = false;

    closeReasonModal();

    $('#portal').hidden = true;
    $('#login').hidden = false;

    $('#cards').innerHTML = '';
    $('#customerGreeting').textContent = '';
    showError('');
  }
);

// Initial load.
load();

// Background refresh.
// It will automatically skip while the customer is
// interacting with or submitting a form.
setInterval(() => {
  load();
}, 5000); 
