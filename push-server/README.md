# RCI lock-screen push service

Deploy this **once** for all four RCI apps. Frontend changes in each app register
the current phone; Power Automate sends the notifications. Existing email actions
can remain enabled. The code is prepared, but Azure deployment and flow editing
are required before phones receive pushes.

## 1. Deploy the shared Azure service

Use an Azure Function App with Node.js 22 and Functions runtime v4, and an Azure
Storage account with Tables support. From this `push-server` directory run
`npm ci`, then `func azure functionapp publish YOUR_FUNCTION_APP --build local` using Azure
Functions Core Tools v4. Do not deploy the website directory as the Function App.

Set these Function App environment variables in Azure (not in GitHub):

| Setting | Value |
| --- | --- |
| `FUNCTIONS_WORKER_RUNTIME` | `node` |
| `AzureWebJobsStorage` | Function runtime storage connection string |
| `PUSH_STORAGE_CONNECTION_STRING` | Storage connection string with Table access |
| `VAPID_PUBLIC_KEY` | Public key from the generated private settings file |
| `VAPID_PRIVATE_KEY` | Private key from the same file |
| `VAPID_SUBJECT` | `mailto:` followed by your real administrator email |

The generated `vapid.private.json` was delivered separately and is never committed.
If keys haven't been generated, run `npm run generate-keys` **once**. Keep the pair
stable across deployments; replacing it requires phones to register again. Keep a
private backup. Do not regenerate the pair separately for each frontend.

The service creates a `PushSubscriptions` table. Each phone is identified by its
push endpoint; devices are isolated by app ID. It validates the existing delegated
Microsoft Graph access token by calling `/me` and verifies read access to that
app's SharePoint site. Email and account ID come from Graph, never browser input.
No additional Entra application or browser-side function key is needed.

Review `src/apps.js` for the actual production origins, destinations and SharePoint
sites. Current custom domains and the owner's GitHub Pages origin are included.
For custom hosting, add only its exact HTTPS origin. If Azure platform CORS is
enabled, allow those same origins there; do not use `*`. Application CORS checks
are also enforced. The `/api/push/send` route has no browser CORS support.

## 2. Activate all four frontends

In **each repository**, edit `push-config.js` and set:

```js
apiBaseUrl: "https://YOUR_FUNCTION_APP.azurewebsites.net/api"
```

Leave each existing `appId` unchanged. Bump `APP_VERSION` in `index.html` and the
matching cache version in `sw.js` when deploying this configuration, as with other
app updates. No VAPID private key, storage key, or Function key belongs in these
files. Until this URL is configured, the UI says notifications await activation.

## 3. Add a push action to Power Automate

Open each existing email flow and, inside the **same conditions and recipient
loop as its email action**, add an HTTP action. This action can require a Power
Automate Premium license. Reuse the email's recipient address, not the flow
owner's account. Configure:

- Method: `POST`
- URI: `https://YOUR_FUNCTION_APP.azurewebsites.net/api/push/send`
- Headers: `Content-Type: application/json` and `x-functions-key: YOUR_SEND_FUNCTION_KEY`
- Body: use `power-automate-request.example.json` as a structural example and
  replace each `REPLACE_...` value with the flow's dynamic content.

Get a **function-specific key for `push-send`** in Azure. Keep it only in Power
Automate or a secret store. Turn on Secure Inputs and Secure Outputs for the HTTP
action, and limit who can edit or export the flow. Never use the master key.

Use the right app ID:

| Team | `appId` |
| --- | --- |
| Productions | `rci-productions` |
| Security | `rci-security` |
| Ushers | `rci-ushers` |
| Worship & Arts | `rci-worship-arts` |

`recipients` must be an array of email addresses matching the member's Microsoft
Graph `mail` or `userPrincipalName`. If an email action has semicolon-separated
recipients, convert them to an array first. For guest users, confirm the address
matches the account they actually use to sign in. Maximum: 100 recipients and 200
matching phone subscriptions per call; split larger groups.

Suggested mappings (apply only to flows that exist in your environment):

| Email trigger | Push recipient | Suggested text |
| --- | --- | --- |
| Schedule request issued | Assigned team member | `You have a new serving request. Open the app to reply.` |
| Request accepted/declined | Current email recipients (leaders) | `A team member replied to a serving request.` |
| Schedule or service update | Current email recipients | `Your team's schedule has changed. Open the app for details.` |
| Announcement | Current email recipients | `There's a new team announcement.` |

Use a stable `eventId`, such as app/list/item ID + item version + event type.
Do not use `utcNow()` alone: a retry should reuse the same ID. The matching
notification tag replaces a still-visible alert for that event, but delivery is
**at least once**, not exactly once; retrying can alert again. Preserve existing
flow trigger conditions so the flow's own updates don't repeatedly trigger it.

The HTTP response contains `matched`, `sent`, `expired`, and `failed` device counts.
Zero matched devices is a successful response (the recipient hasn't subscribed).
404/410 push endpoints are removed. Other delivery failures produce HTTP 503 so
the flow can retry with exponential backoff. One call can partially succeed;
keep its event ID unchanged when retrying. Route the email action independently
or configure Run After so a push failure doesn't suppress email.

## 4. Test on an actual phone

1. Deploy the service, update the four public configuration files, then deploy
   each app's frontend changes.
2. On iPhone/iPad with iOS/iPadOS 16.4+, Add to Home Screen, launch from the app
   icon, sign in, and tap **Enable Notifications**. Permission must be requested
   from that tap. Desktop/Android supported browsers can subscribe too.
3. In a trusted server or flow, send the example request with your real subscribed
   email, the correct app ID, and the private `push-send` Function key.
4. Lock the phone, trigger a real flow, and confirm the alert and tap destination.
   Check Lock Screen notification settings and Focus if delivery is quiet. A push
   provider accepting a message does not guarantee immediate visible delivery.
5. Repeat for every app; a phone must enable each installed app separately.
6. Turn notifications off in My Profile, then verify no new alert arrives there.
   Signing out also unsubscribes this phone. Test two accounts/devices to confirm
   recipients and teams remain separate. Account membership changes should also
   be paired with removing that person's stored subscriptions.

The existing badge count still refreshes from live schedule data while the app
is open; background pushes do not attempt to infer a new unread count.

## Verification

`npm test` covers identity binding, recipient/app isolation, endpoint validation,
payload bounds, removal ownership, and stale-device cleanup. Additional frontend
and worker tests live in `test/`. No Azure resources or real phone subscriptions
are required for these tests. Live Azure/Power Automate and lock-screen delivery
still require the end-to-end phone test above.

References: [Apple Web Push requirements](https://webkit.org/blog/13878/),
[Azure Functions HTTP authorization](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger),
[web-push library](https://github.com/web-push-libs/web-push).
