# Lock-screen notifications

This app now supports push subscriptions and visible service-worker notifications.
The Azure service and Power Automate flows must be configured before delivery works.

The shared service for all four RCI apps is in the [rci-productions push-server directory](https://github.com/astmacary/rci-productions/tree/codex/lock-screen-push/push-server).
Follow its [setup and test instructions](https://github.com/astmacary/rci-productions/blob/codex/lock-screen-push/push-server/README.md).

After deploying that service, set `apiBaseUrl` in this repository's `push-config.js`
to its HTTPS URL ending in `/api`. Keep this app's existing `appId` unchanged.
Bump the matching app and worker cache versions when changing configuration.
Never put a function key or VAPID private key in this repository.

On iPhone/iPad (iOS/iPadOS 16.4+), install this app on the Home Screen, open it from
its icon, sign in, and tap Enable Notifications. Each installed team app must be
enabled separately. Turn Off on This Device and signing out unsubscribe this phone.

Existing emails remain unchanged. A Power Automate HTTP action sends the push to
the same recipients as the email, using this app's ID from `push-config.js`.
The actual Power Automate flows are managed outside GitHub and still require editing.
