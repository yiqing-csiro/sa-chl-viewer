const mount = document.querySelector("[data-forecast-email]");

if (mount) initialiseEmailReports(mount);

async function initialiseEmailReports(target) {
  const sendTrigger = makeTrigger("Loading email…");
  const subscribeTrigger = makeTrigger("Loading subscriptions…", "weekly-subscribe-trigger");
  target.append(sendTrigger, subscribeTrigger);

  let config;
  try {
    const response = await fetch("email-config.json", {cache: "no-store"});
    if (!response.ok) throw new Error("Email configuration could not be loaded.");
    config = await response.json();
    validateConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendTrigger.textContent = "Email unavailable";
    subscribeTrigger.textContent = "Subscriptions unavailable";
    sendTrigger.title = message;
    subscribeTrigger.title = message;
    return;
  }

  const responseFrame = document.createElement("iframe");
  responseFrame.className = "forecast-email-response-frame";
  responseFrame.name = "forecast-email-response-" + randomId();
  responseFrame.title = "Forecast email response";
  target.after(responseFrame);

  configureEmailAction(sendTrigger, responseFrame, config, {
    action: "sendForecast",
    trigger: "Send forecast to my email",
    heading: "Send forecast to my email",
    description: "Receive the latest four-week chlorophyll forecast as an illustrated HTML report.",
    submit: "Send report",
    pending: "Preparing and sending your four-week forecast…"
  });
  configureEmailAction(subscribeTrigger, responseFrame, config, {
    action: "subscribe",
    trigger: "Subscribe to weekly reports",
    heading: "Subscribe to weekly reports",
    description: "Get the latest 10-week history and four-week forecast after each weekly update. Confirm your address by email; unsubscribe at any time.",
    submit: "Subscribe",
    pending: "Creating your subscription…"
  });
}

function makeTrigger(label, extraClass = "") {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = ("forecast-email-trigger " + extraClass).trim();
  trigger.textContent = label;
  trigger.disabled = true;
  return trigger;
}

function configureEmailAction(trigger, responseFrame, config, copy) {
  const dialog = document.createElement("dialog");
  dialog.className = "forecast-email-dialog";
  dialog.innerHTML = '<form class="forecast-email-form" method="post"><div class="forecast-email-heading"><div><h2></h2><p></p></div><button class="forecast-email-close" type="button" aria-label="Close">×</button></div><label class="forecast-email-field">Email address<input name="recipient" type="email" autocomplete="email" maxlength="254" inputmode="email" placeholder="name@example.com" required></label><div class="forecast-email-captcha" aria-label="Human verification"></div><input name="action" type="hidden"><input name="captchaToken" type="hidden"><input name="requestId" type="hidden"><p class="forecast-email-status" role="status" aria-live="polite"></p><div class="forecast-email-actions"><button class="forecast-email-cancel" type="button">Cancel</button><button class="forecast-email-submit" type="submit"></button></div></form>';
  document.body.appendChild(dialog);

  const form = dialog.querySelector("form");
  const emailInput = form.elements.recipient;
  const captchaInput = form.elements.captchaToken;
  const requestInput = form.elements.requestId;
  const captchaBox = dialog.querySelector(".forecast-email-captcha");
  const status = dialog.querySelector(".forecast-email-status");
  const submit = dialog.querySelector(".forecast-email-submit");
  const cancel = dialog.querySelector(".forecast-email-cancel");
  const close = dialog.querySelector(".forecast-email-close");
  let captchaWidget;
  let pendingRequestId = "";
  let timeout;

  dialog.querySelector("h2").textContent = copy.heading;
  dialog.querySelector(".forecast-email-heading p").textContent = copy.description;
  form.elements.action.value = copy.action;
  form.action = config.endpoint;
  form.target = responseFrame.name;
  submit.textContent = copy.submit;

  function setStatus(message, kind = "") {
    status.textContent = message;
    status.className = ("forecast-email-status " + kind).trim();
  }

  function setPending(pending) {
    submit.disabled = pending;
    cancel.disabled = pending;
    close.disabled = pending;
    emailInput.readOnly = pending;
    submit.textContent = pending ? "Sending…" : copy.submit;
  }

  function resetCaptcha() {
    if (captchaWidget !== undefined && window.grecaptcha) {
      window.grecaptcha.reset(captchaWidget);
    }
    captchaInput.value = "";
  }

  async function openDialog() {
    submit.disabled = false;
    setStatus("Loading secure verification…");
    dialog.showModal();
    try {
      await loadRecaptcha();
      if (captchaWidget === undefined) {
        captchaWidget = window.grecaptcha.render(captchaBox, {
          sitekey: config.recaptchaSiteKey,
          theme: "light"
        });
      }
      setStatus("Complete the verification, then continue.");
      emailInput.focus();
    } catch {
      setStatus("Human verification could not be loaded. Please try again later.", "error");
      submit.disabled = true;
    }
  }

  function closeDialog() {
    if (!pendingRequestId) dialog.close();
  }

  trigger.textContent = copy.trigger;
  trigger.disabled = false;
  trigger.addEventListener("click", openDialog);
  cancel.addEventListener("click", closeDialog);
  close.addEventListener("click", closeDialog);
  dialog.addEventListener("cancel", event => {
    if (pendingRequestId) event.preventDefault();
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) closeDialog();
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (pendingRequestId || !form.reportValidity()) return;
    const captchaToken = window.grecaptcha?.getResponse(captchaWidget) || "";
    if (!captchaToken) {
      setStatus("Please complete the human verification.", "error");
      return;
    }

    pendingRequestId = randomId();
    captchaInput.value = captchaToken;
    requestInput.value = pendingRequestId;
    setStatus(copy.pending);
    setPending(true);
    timeout = setTimeout(() => {
      pendingRequestId = "";
      setPending(false);
      resetCaptcha();
      setStatus("The email service did not respond. Please try again.", "error");
    }, 60000);
    HTMLFormElement.prototype.submit.call(form);
  });

  addEventListener("message", event => {
    if (!isTrustedAppsScriptOrigin(event.origin)) return;
    const result = event.data;
    if (!result || result.type !== "forecast-email-result" ||
        result.requestId !== pendingRequestId) return;

    clearTimeout(timeout);
    pendingRequestId = "";
    setPending(false);
    resetCaptcha();
    if (result.ok) {
      emailInput.value = "";
      setStatus(result.message || "Request completed successfully.", "success");
    } else {
      setStatus(result.message || "The request could not be completed. Please try again.", "error");
    }
  });
}

function isTrustedAppsScriptOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.port === "" &&
      (url.hostname === "script.google.com" ||
       url.hostname.endsWith("-script.googleusercontent.com"));
  } catch {
    return false;
  }
}

function validateConfig(config) {
  if (!config?.endpoint || !config?.recaptchaSiteKey) {
    throw new Error("Email delivery has not been configured.");
  }
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.hostname !== "script.google.com" ||
      !endpoint.pathname.startsWith("/macros/s/")) {
    throw new Error("Email endpoint is not a valid Google Apps Script deployment.");
  }
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

let recaptchaPromise;
function loadRecaptcha() {
  if (window.grecaptcha?.render) return Promise.resolve();
  if (recaptchaPromise) return recaptchaPromise;

  recaptchaPromise = new Promise((resolve, reject) => {
    const callbackName = "forecastEmailRecaptchaReady_" + randomId().replaceAll("-", "");
    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?onload=" + callbackName + "&render=explicit";
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete window[callbackName];
      recaptchaPromise = undefined;
      reject(new Error("reCAPTCHA failed to load."));
    };
    document.head.appendChild(script);
  });
  return recaptchaPromise;
}
