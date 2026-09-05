# Sanitized Director export — email-signup.v1

Internal prototype export. Not a live Director session. No credentials, cookies, selectors beyond public signup fields, or account identities.

```json
{
  "id": "email-signup",
  "version": "email-signup.v1",
  "sourceCommit": "beeab5c7ca76ccac3cfa25eabf371f573561519d",
  "signupMethod": "email",
  "reviewedSignupUrl": "https://www.reddit.com/register/",
  "allowedOrigins": [
    "https://www.reddit.com",
    "https://reddit.com",
    "https://old.reddit.com"
  ],
  "privacy": {
    "recordSession": false,
    "logSession": false,
    "captchaSolving": false,
    "advancedStealth": false,
    "validateCertificates": true
  },
  "allowedActions": ["navigate", "fill", "click", "wait", "observe", "read_identity"],
  "forbiddenActions": [
    "evaluate",
    "cdp",
    "unrestricted_prompt",
    "accept_terms",
    "grant_oauth",
    "solve_captcha",
    "post",
    "vote",
    "send_message",
    "rotate_proxy",
    "create_mailbox"
  ],
  "steps": [
    { "id": "open_signup", "action": "navigate", "url": "https://www.reddit.com/register/" },
    { "id": "fill_username", "action": "fill", "fieldLabel": "username" },
    { "id": "fill_email", "action": "fill", "fieldLabel": "email" },
    { "id": "wait_result", "action": "wait" }
  ],
  "humanRequired": ["age_gate", "terms", "otp", "captcha", "final_submit_approval"],
  "model": {
    "maxObservations": 8,
    "credentialsToModel": false,
    "sensitivePagesSkipModel": true
  },
  "review": {
    "liveRedditValidated": false,
    "fixtureOnly": true,
    "assistedRuntimeEnabled": false
  }
}
```

Reviewer notes: Google/Apple/phone signup is unsupported. Apparent success still requires the owner to verify and then connect with OAuth. This export does not prove an account was created.
