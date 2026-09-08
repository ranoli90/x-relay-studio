# Operator control → server → persistence

Authenticated fixture browser tests: NOT_RUN in this environment.

| Control | Server fn | Validates | Persists | Pending | Success | Failure | Reload | test id |
|---|---|---|---|---|---|---|---|---|
| Inbox tab | — | — | shellTab local | — | list visible | — | stays | nav-inbox |
| Business tab | loadOperatorDeskFn | auth | published projection | spinner via busy | offers listed | error text | reload desk | nav-business |
| Publish brief | publishBusinessFn | brief + priced offers + currency | business_revisions/offers atomic | busy | revision line | error | loadOperatorDeskFn | business-publish |
| Media propose | proposeMediaFn | approved asset | media_proposals approved_not_sent | note | honest copy | revoked/missing | reload | media-propose |
| Activity | loadOperatorDeskFn | auth | send_attempts | — | status labels | error | reload | nav-activity |
| Watching | telegramSetWatchingFn | not preview | telegram_user_sessions.watching | busy | switch | error banner | load | settings-watching |
| Draft replies | telegramSetAutomationFn | not preview | automation_armed | busy | switch | error | load | settings-drafts |
| Processing permission | setProcessingPermissionFn | auth | processing_permission + revision++ | busy | switch | revert | load | settings-permission |
| Auto-send (desired) | setAutoSend | auth | auto_send + desired_auto_reply + mode | busy | switch; effective label | revert | load | settings-autosend |
| Background | setBackgroundRun | auth | background_run | busy | switch | revert | load | settings-background |
| Stop | setEmergencyStop | auth | persona+session emergency_stop; auto_send false | busy | switch; effective Stopped | revert | load | settings-stop |
| Takeover | setTakeoverFn | conversationId | agent_threads.takeover | busy | switch | revert | sheet | sheet-takeover |
| Customer opt-out | setPartnerOptOutFn | conversationId | opt_out + consent_epoch++ | busy | switch | revert | sheet | sheet-optout |
| Composer | telegramSendFn / saveDraftFn | non-empty, IME | telegram_messages / composer_drafts | sending | confirmed label | restore draft | cache | composer-send |
| Visible ack | ackVisibleFn | conversation visible | unread=0 | — | badge clear | unread stays | sync | unread-ack |
| Disconnect | telegramUnlinkFn | confirm dialog | session dropped + eraseOperatorDerivedData | busy | navigate | error | — | settings-unlink |
