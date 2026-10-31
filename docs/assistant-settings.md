# Assistant studio: every option of a client's assistant

Admin, client, **Assistant studio** (`/admin/clients/<id>/assistant`). One card per section, each saved on its own:

| Section | What it sets |
| --- | --- |
| AI model | The language model (with what it costs us and what we keep), temperature, longest reply (0 = no limit, otherwise 300 to 4096), thinking level, parallel tools, backup models, answer speed tier (Standard or Fast) |
| Voice | English and Arabic voice (search our ElevenLabs account or the public voice library, with sound samples), voice model per language, stability, similarity, speed, number reading, expressive mode, the voices the client may choose from, V3 styles (suggested audio tags), audio effects on the voice (filter, room, noise, distance, from ElevenLabs' catalogue) |
| Conversation | How quickly it answers, wait times, hang up after silence, longest call, "one moment" phrase, the greeting in each language, background sound and its volume, first wait when there is no greeting, words that must not interrupt (plus ElevenLabs' own English and Arabic list), turn detection model, file uploads in website chat |
| Hearing | Speech recognition provider (Standard, or Scribe v2 Turbo), extra words to listen for (clinic and doctor names are added automatically) |
| Safety, privacy and limits | Topic guard, prompt-injection guard, record audio, conversations per day, simultaneous calls, bursting, waiting queue and its longest wait, hold audio (upload or remove an MP3/WAV) |
| Call analysis | Language of call summaries, which quality checks ElevenLabs runs (in the client's own words; the medical-advice check only for clinics), labels on the agent in ElevenLabs (CallsDash and the business type are always added) |
| Website widget | Brand or custom colours, size, position, texts, which controls visitors get, and the small "Powered by" line under the widget |

Below the sections: **Live in ElevenLabs** (reads the assistant back from ElevenLabs and sets each value beside what CallsDash saved), **What ElevenLabs charges us** (the two fees every cost starts from) and **Try the assistant** (the same test panel as the client page).

**The "Powered by" line.** The ElevenLabs widget shows a small "Powered by ElevenLabs" line under the conversation unless the agent's widget settings switch it off (`platform_settings.widget.disable_banner`; there is no attribute on the `<elevenlabs-convai>` tag for it). Every assistant is synced with that switch **on** (the line hidden), also for a client whose Website widget section was never saved; an admin can show it again with the tick-box **Hide the "Powered by" line under the widget**. It is sent as its own group (`branding`), so if ElevenLabs refuses it (ElevenLabs does not say which plans allow it) the widget's look is still applied, the page names the group and says why, and **Live in ElevenLabs** shows the row as different. Nothing else about the widget changes: it is still the original ElevenLabs widget, only without that line.

**Instructions and greetings.** Under the table, *Live in ElevenLabs* also compares the instructions, the English greeting and the Arabic greeting. Each shows Matches or Differs (extra spaces and line endings are ignored). *Show the difference* lists the text line by line: `-` is only in CallsDash (a save puts it back), `+` is only in ElevenLabs (a save removes it). This is how a change made by hand inside ElevenLabs becomes visible before a save replaces it. Code: `liveTexts` in `lib/studio-live.ts`, `lib/text-diff.ts`.

**Choosing a model for booking calls.** Only Gemini 2.5 Flash (the built-in default) has been seen booking an appointment through the tools (`BOOKING_TESTED` in `lib/agent-catalog.ts`), so every other model shows a note asking for a test in **Try the assistant** first: book, look the booking up, move it. On 2026-10-25 a real voice call on Gemini 3.5 Flash Lite ran for 1:40 and then ended with ElevenLabs' *Invalid message received: Unterminated string starting at: line 1 column 157* right when the assistant had to send the "move this booking" request, and other voice platforms report Gemini 3 models going silent after a booking tool call (missing thought signatures, streaming, parallel tool calls). That is the best explanation so far, not a proven one; a model is only added to the tested list after a successful test.

**Longest reply** (`max_tokens` on the agent's language model). 0, the default, is sent as -1: no limit. A limit is spent on the model's tool calls as well as on what it says, and the arguments of `book_appointment` alone are about 130 tokens (doctor id, ISO time, name, phone, CPR, service, language), so a reply that hits a low limit inside them would reach ElevenLabs as a half-written tool call. That is why the lowest allowed value is 300 (`LIMITS.maxTokens`): the form refuses anything between 1 and 299 with its own message, and a value saved below 300 earlier is read as 300, which the next sync sends. A model that thinks before it answers spends the limit on thinking too, so with a thinking level set, keep the limit at 0 or well above 1000. For shorter spoken replies use **Reply length** under Agent and prompt, which is an instruction in the prompt, not a cut-off. (The voice chat error of 2026-10-25, *Invalid message received: Unterminated string starting at: line 1 column 157*, was not this: that clinic's limit was 0.) To see why any conversation failed, ElevenLabs lists it on its **Call History** page with a red message (its help centre, "Where can I locate the reason for my call failing?"; the page name may differ in the current dashboard).

A custom greeting should still say the conversation is recorded. The page warns, under the greeting fields, when a saved greeting does not mention it (English: "record"; Arabic: any form of تسجيل / مسجلة). It is a warning only; leave a greeting blank to use the built-in one, which says it.

## How a save works

1. The form is checked (ranges, allowed choices, the model against ElevenLabs' own list).
2. The change is sent to the client's agent in ElevenLabs.
3. Only when ElevenLabs accepts the core settings (model, temperature, voices, voice models, longest call) is it stored in CallsDash. A refusal shows ElevenLabs' own words (kept on the server for a few minutes, never read from the address) and stores nothing, so a refused change is not saved on our side.
4. Optional groups (safety, analysis, widget, tuning) are sent as separate requests. If ElevenLabs refuses one, the assistant still works, the page names the group and says why, and the value stays saved here, so **Live in ElevenLabs** will show it as different until ElevenLabs accepts it.

Every save is a full sync, not only the changed option: the core settings (instructions, greeting, voices and their models, the Arabic preset, temperature, model) and every group of a section already saved are sent again. So a value someone changed by hand inside ElevenLabs is put back to the CallsDash value at the next save of any section and at **Update the assistant**. **Live in ElevenLabs** warns about this whenever a row differs; to keep an ElevenLabs value, set the same value in the studio first.

Nothing keeps the two sides identical for ever: someone can edit the assistant inside ElevenLabs, or a request can fail half way. That is what **Live in ElevenLabs** is for. Its states are *Matches*, *Differs* (CallsDash sent a value and ElevenLabs shows another), *Not set* (that section was never saved, so ElevenLabs keeps its own value) and *Not used* (the chosen model never reads that setting, for example the temperature of a newer Claude or GPT model).

A client that has no assistant in ElevenLabs yet stores the choices; they are used when the assistant is created. The same happens when `ELEVENLABS_API_KEY` or the app address is missing: the page says "saved here, not sent yet".

A section's newer options reach ElevenLabs only after an admin saved that section once (the badge changes from "Defaults" to "Customised"). Clients that were never touched keep exactly the agent they had before. A saved section sends all its options (the Hearing section always sends its provider, "Standard" meaning Scribe Realtime), so **Back to defaults** really resets the assistant. The settings live in `AgentSettings.studio` (jsonb, no migration); `lib/agent-studio.ts` has the allowed values and limits.

## What it costs and what we keep

One credit is one voice minute or twenty chat messages. For a model, **our cost per minute** is ElevenLabs' own fee plus the model's share, and **we keep** is the share of the client's price left after that cost. The client's price is the cheapest of their active plans (a package's fee spread over its credits, or the pay-as-you-go credit price); green is 40% and up, amber 15% and up, red below.

- ElevenLabs' fee defaults to $0.08 per voice minute and $0.003 per chat message and is edited in **What ElevenLabs charges us**. The minute fee is from ElevenLabs' price list; the chat fee is a third-party figure, so compare with the first real invoice.
- The model's share comes from ElevenLabs' price calculator for the client's real instructions and knowledge base. It depends on how long that client's instructions are, so the answer is kept **per client** (read live, kept for ten minutes in memory, and the last good answer is saved in the database under that client). The model list itself is the same for everyone and is saved once. When the calculator cannot be reached the page says so and uses that client's last saved prices, or the built-in estimate from each model's price per million tokens (`lib/agent-catalog.ts`, marked with `*`) when there are none. One client's prices are never used for another.
- "A month of calls" uses the client's own last 30 days, or an example month (2,000 voice minutes, 8,000 messages) while there are fewer than five conversations.
- Dollars are shown in dinar at the pegged rate 0.377.

Each finished conversation is recorded with the same sums (`lib/costing.ts`): the minutes or messages times the client's model (using that client's saved prices) and the fees, so **Usage and margin** follows the model chosen here. These are estimates, not ElevenLabs' invoice. Conversations recorded without the sums (demo data) keep a flat estimate of $0.13 per minute and $0.005 per message.

## Voices

**Change voice** opens a search of the voices already in our ElevenLabs account (including cloned ones) or of the public library, filtered by language, gender and accent, with a sample to play. A library voice is copied into our account before it is used. "Verified for Arabic" appears when ElevenLabs lists the voice as verified for that language; nobody publishes which Arabic voices sound Gulf, so listen and use **Try the assistant** in Arabic before settling.

**Voice models.** ElevenLabs answered "400" when an assistant whose main language is English was given Flash v2.5 (seen on the first real sync, 2026-10-21), and accepted Flash v2. So the English side offers Flash v2 (the default), v3 Conversational and v4 Turbo; the last two have not been tried on a real English assistant yet, and a refusal is shown with ElevenLabs' words and stores nothing. The Arabic side offers Flash v2.5 (the default), Multilingual v2, v3 Conversational and v4 Turbo. Retired models (Turbo v2 and v2.5) and v4 (made for recorded audio, not for live calls) are hidden unless the assistant already uses them. **Expressive mode** follows the English model: it is only offered with v3 Conversational or v4 Turbo.

**Voices the client may choose from** is a list per language. The client sees it on their Voice page (name, gender, accent, sample); with an empty list they see the four built-in voices. Their current voice always stays selectable, and a voice that is not on the list is not accepted when they save.

Rachel, the default behind the built-in voices, is on ElevenLabs' list of older voices and ElevenLabs may swap it for another voice from the end of 2026. The screen says so and suggests picking a voice of your own.

## Recommended values

Every section ends with **Recommended settings for this section**: each setting with the value CallsDash suggests for a receptionist and one line on what it does (the values of the built-in *Recommended* profile, `recommendedFor` in `lib/studio-profiles.ts`). It says how many settings differ; **Use recommended** (with a tick box) puts the section on those values and sends it to ElevenLabs like a save. The client's own voices, greetings, extra words, V3 styles, labels and widget texts and colours are never touched.

## Added in step 4 (2026-10-31)

Read from ElevenLabs' JavaScript SDK 2.75.0 (`conversation_config.agent.prompt.service_tier`, `tts.suggested_audio_tags`, `tts.audio_effects`, `conversation.background_sound`, `turn.initial_wait_time`, `turn.interruption_ignore_terms` with `interruption_ignore_term_languages` and `merge_with_default_ignore_terms`, `turn.turn_model`, `conversation.file_input`, `platform_settings.queueing_config`, top-level `tags`, `POST/DELETE /v1/convai/agents/{id}/hold-audio`, `GET /v1/audio-effects/catalog`). Each is sent in its own group (`tier`, `effects`, `sound`, `interrupt`, `files`, `queue`, `tags`), so a refusal is a warning naming the group and the rest still applies. Only `tags` is sent for every client; the others only once their section is saved. An older form without the hidden `more` field keeps the newer options as saved. Hold audio goes through `/api/hold-audio` (a plain form post, admins only, same-site), at most 4 MB because Vercel takes about 4.5 MB per request; larger clips can be uploaded inside ElevenLabs. None of this was tried against the real ElevenLabs from the build environment.

## Added in step 5 (2026-10-31): knowledge base search and procedures

**Knowledge base search** (studio section `knowledge`, group `rag`, sent as `conversation_config.agent.prompt.rag`): `ragEnabled` (off by default), `ragEmbedding` (`multilingual_e5_large_instruct`, recommended because callers use English and Arabic, or `e5_mistral_7b_instruct`), `ragMaxLength` (characters of knowledge per answer, 1,000 to 200,000, recommended 50,000) and `ragMaxChunks` (pieces looked up per question, 1 to 50, recommended 20). The section says how long the client's knowledge base is and recommends search on from about 30,000 characters. Read back on *Live in ElevenLabs* and imported by *Read from ElevenLabs*. The model price list is still worked out with search off, so it errs on the high side when search is on.

**Procedures** (page `/admin/clients/[id]/assistant/procedures`, card in the studio; code `lib/procedures.ts`, `lib/procedure-actions.ts`): step-by-step routines the assistant follows when a situation comes up. They live only in ElevenLabs on the agent's main branch (`main_branch_id` from GET agent; `/v1/convai/agents/{a}/branches/{b}/procedures`, `/{id}`, `/{id}/draft`). The page lists them with their steps (the draft when there is one), and each can be edited (PATCH draft) or deleted (tick box). New ones start blank or from four templates in the client's own words (complaint, new customer asking for prices, call back, same-day cancellation). Every change publishes the agent at once (a PATCH with only `version_description`, which takes drafts live), so there is no separate publish step; a full sync from CallsDash never sends `procedures`, so it leaves them alone. ElevenLabs' reason for a refusal is kept on the server for ten minutes (`procedures.fail.<clientId>`) and shown on the page. Folders are not shown. Kinds: *Guidance* (`free_form`, recommended) and *Exact steps* (`deterministic`). Shapes from the SDK 2.75.0, not yet tried against the real service.

## Not in the studio

Left out on purpose: pronunciation dictionaries, thinking budget, monitoring, PII redaction and zero retention (they would break recordings and the CPR lookups), ElevenLabs' own alerting (it needs a webhook, Slack or PagerDuty connection made inside ElevenLabs; CallsDash has its own alerts), per-channel text behaviour, keypad (DTMF) input until a phone number exists. A phone number will also need the audio format `ulaw_8000` for the agent's output and input when it is connected (Twilio).

## Tests

`ELEVENLABS_API_BASE` points the app at a local fake ElevenLabs for tests and screenshots; in production it stays unset. The request shapes follow the ElevenLabs JavaScript SDK 2.74.0 and were not tested against the real service from the build environment. On the first real account check, in this order:

1. Open a client's Assistant studio. The model list should say "Live" and the prices "ElevenLabs' price".
2. Press **Save and apply** on the Voice section and open **Live in ElevenLabs**: every row should say "Matches".
3. Pick another model, save, and place a test call or chat through **Try the assistant**.
4. After the first invoice, compare it with **Usage and margin** and adjust the two fees.

If ElevenLabs refuses something, the page shows its message; send that text so the request can be corrected.

## Using another ElevenLabs agent

Channels > *Use another ElevenLabs agent* points a client at an agent the admin made by hand in ElevenLabs (paste its `agent_…` ID). The app checks the ID exists under the API key's account and that no other client uses it, then switches. Nothing is written inside either agent. The agent left behind is listed under *Agents this client used before* with its sync state (`integrations.elevenlabs.others`), and one press switches back. A connected agent is not managed (`managed: false`): nothing writes to it. Auto-sync skips it, Save and apply in the Assistant studio keeps the change in CallsDash only, and `syncAgent` refuses it (`SyncError` `connected`). The only way in is the collapsed *Advanced: let CallsDash manage this agent* on the Channels page (tick box, then *Replace the agent's settings*), which installs the booking tools and replaces the agent's text, greeting, voices, settings and knowledge with CallsDash's. Reading stays on: *Live in ElevenLabs* still compares both sides. Code: `lib/agent-switch.ts`, `useAgentAction`.

## Profiles and "Read from ElevenLabs"

Page: `/admin/clients/[id]/assistant/profiles` (a card at the top of the studio links to it).

- **Read from ElevenLabs** (`lib/studio-import.ts`): reads the agent, shows every setting that differs, and copies only the ticked ones into CallsDash. It never writes to ElevenLabs, so edits made by hand there are kept, and later syncs no longer revert them. The long instructions are not read (CallsDash builds them) and neither is the recording retention (it belongs to the client).
- **Profiles** (`lib/studio-profiles.ts`): a profile is a flat `key: value` list over `FIELDS`, one key per studio setting (plus temperature and the two voices). Four come with CallsDash (balanced for a clinic, lowest cost, best quality, patient and clear); they never hold the client's own voices, greetings, extra words, widget colours or texts. Saved profiles (stored once for all clients, setting `studio.profiles`, at most 30) hold every setting.
- **Applying** shows the exact changes first, needs a tick, checks the model and voice models against ElevenLabs' lists, then does a full sync (`commitCandidate` in `lib/studio-apply.ts`), so it replaces hand edits in ElevenLabs. The sections a profile touches count as saved.
- Every setting has a hint (`prof.h.*`, how to use it and its impact) in English and Arabic; `tests/studio-profiles.test.ts` checks the lists, texts and that a sync can be read back with no difference.
