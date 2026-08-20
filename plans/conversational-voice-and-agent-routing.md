# Conversational voice and originating-agent routing

## Status

Exploratory and deliberately separate from
[first-class tour narration](tour-text-to-speech.md). This work is not a
prerequisite for TTS and should not begin until the conversation route,
authority model, and local binding design are approved.

## Goal

Let a reader ask a question about the tour's current scene, step, file, or
evidence and hear an answer. When the tour was produced by a still-reachable
agent session, optionally preserve that session's context by routing the
question back to it.

“Voice” is an input/output modality, not the conversation backend. The system
must also work as typed question and text answer so routing, context, safety,
and failure behavior can be proven before microphone and realtime audio
complexity are added.

## Why this is a different product surface

TTS reads immutable authored text. Conversational voice introduces:

- microphone permission and speech recognition;
- a live model or agent with latency and usage cost;
- a transcript and conversation lifecycle;
- dynamic context assembled from the current tour position;
- authentication and a transport to an agent runtime; and
- possible tool calls, approvals, repository reads, or writes.

Those concerns change Bygone from a presenter into an interactive agent
client. Sharing its speech output with TTS is useful, but it does not make the
two features one scope.

## Proposed interaction

Add an **Ask about this** surface to Present only after a text-only prototype
passes the routing and safety gates.

1. The reader activates Ask and sees exactly what context will accompany the
   question: tour, scene/step, active file, focused evidence, and any explicit
   selection.
2. The reader types a question; a later slice may record and transcribe it.
3. Bygone shows the transcript before submission when speech recognition is
   uncertain or the question could trigger an action.
4. A route badge identifies the destination, for example **Original agent ·
   Codex**, **Original agent · Agent name**, **New read-only helper**, or
   **Unavailable**. The actual label always uses the integration's declared
   agent name.
5. The answer streams as text with citations back to tour scene/step IDs and
   source anchors when the backend can provide them.
6. The reader may play the answer with the existing TTS engine. Voice output
   remains cancellable and never hides the text answer.

The conversation panel should not replace the tour narrative or diff. It is a
secondary drawer that preserves the active evidence and can be closed without
changing tour position.

## Conversation modes

Treat these as distinct modes rather than silent fallbacks.

### Route to the originating agent

Use the original conversation only when all of the following are available:

- an authenticated local agent bridge;
- a live, resumable conversation reference registered for this presentation;
- a workspace/repository match;
- declared capabilities for questions, cancellation, and approval handling;
  and
- explicit reader choice to continue that conversation.

The product contract is agent-neutral. Any authoring agent may be the origin
when its integration can register a resumable conversation route with the
required identity, context, cancellation, and authority capabilities. The UI
uses the agent's declared display name and never substitutes a generic or new
helper while claiming it is the origin.

[Official Codex documentation](https://learn.chatgpt.com/docs/mcp-server#running-codex-as-an-mcp-server)
provides one concrete adapter path: when Codex is run as an MCP server, its
`codex-reply` tool can continue a session using its `threadId`. Codex is a
reference integration, not a format requirement or privileged conversation
mode. Other agents may use MCP, a local SDK, a CLI bridge, or another
authenticated transport while conforming to the same Bygone route contract.

### Start a new read-only helper

A new helper may answer from the compiled tour context and repository snapshot
without inheriting the original conversation. This is a separate, visibly
named route. It must not be presented as the authoring agent and must not be
used silently when original-session routing fails.

### No live route

Portable tours, emailed manifests, stale local bindings, and browser-only
presentations may have no agent route. Ask is disabled with useful copy while
ordinary tour navigation and TTS continue to work.

## Origin binding and portability

Do not store a raw agent thread/session ID, provider credential, bearer token,
local socket path, or agent endpoint in a version-1 source or compiled tour
manifest.

A compiled `.tour.json` can leave the repository and contains source
snapshots. Embedding a resumable session identifier would create a misleading
portability promise and could disclose a capability or durable local identity.
An authored `.bygone` file is also not a credential store.

Instead, bind origin at launch through a local broker:

```text
tour content identity
  + repository realpath and range OIDs
  + opaque, session-scoped origin handle
  -> authenticated local route registration
```

The presentation receives only an opaque route capability with a short
lifetime and narrow allowed operations. The trusted host retains the actual
agent kind, conversation handle, credentials, and transport. Closing the
presentation revokes the capability. Moving the tour to another machine
preserves presentation and TTS but not the live route.

If generation tooling later needs to advertise that a route may exist, add a
non-secret provenance hint only after the broker contract is proven. Do not
change the public schema during the prototype.

## Context packet

Build a bounded, inspectable request from stable tour semantics:

- tour title and base/head OIDs;
- active chapter, scene, and optional step IDs;
- scene summary, active step body, and takeaway;
- active file and resolved focus/connection anchors;
- an explicit selected range, when the reader chose one;
- recent Q&A turns from this presentation; and
- the reader's question.

Do not resend every source snapshot or the entire repository by default. The
originating agent may already have conversation and workspace context; a new
helper can request additional bounded evidence through a read-only host
operation. Show a concise context preview and log neither source text nor
transcripts by default.

Answers should cite stable scene, step, file, and line identities rather than
inventing new unverified anchors. When an answer cannot be grounded in the
tour or accessible repository state, it should say so.

## Authority and safety contract

The first interactive release is question answering, not voice-driven coding.

- The Bygone route may read the supplied context and return text.
- It may not approve commands, mutate files, run production operations, post
  externally, or convert speech into an action confirmation.
- If the originating conversation attempts a tool call, approval request,
  user-input request, or mutation, the broker stops the turn and offers to open
  the agent client for an explicit handoff.
- Bygone never speaks an approval as if it were a completed action.
- Interrupting audio or closing Ask cancels the in-flight request when the
  backend supports cancellation; otherwise its late result is discarded.

This boundary may require a dedicated read-only continuation mode or a new
helper rather than directly resuming a fully empowered authoring conversation.
That is a decision gate: preserving conversational context does not justify
silently preserving write authority.

## Architecture

Use a chained pipeline for the first voice slice:

```text
microphone -> speech to text -> visible question
           -> context builder -> agent route -> streamed text answer
           -> existing TTS engine -> audio
```

The text transcript is the audit boundary. It supports correction,
accessibility, deterministic request tests, and a clean handoff to an existing
text-based agent. Direct speech-to-speech realtime interaction can be
reconsidered only if measured latency makes the chained path unusable and the
same transcript, grounding, and authority guarantees can be preserved.

### Trusted local broker

The Electron main process or an explicitly launched local companion owns:

- route registration and revocation;
- agent credentials and conversation identifiers;
- microphone/STT and model credentials;
- context-size enforcement and workspace matching;
- cancellation and approval/tool-call interception; and
- answer streaming to the sandboxed presenter.

The presenter must not connect to arbitrary endpoints supplied by a tour. Use
loopback transport with an unguessable per-presentation capability, strict
origin checks, request-size limits, and no permissive CORS. A browser opened by
`bygone present` may use the presentation server as the broker only when that
server was explicitly launched with an agent route.

### Narrow route contract

Define an agent-neutral `AgentConversationRoute` before implementing any agent
adapter. Keep it deliberately narrow:

- describe the originating agent's display identity, conversation continuity,
  and capabilities;
- submit a text question plus the context packet;
- stream text answer events;
- cancel a turn; and
- report unavailable, expired, approval-required, and failed states.

Each adapter owns translation between this contract and its agent's thread,
session, or conversation API. Agent-specific identifiers and event shapes
stop at that boundary. Codex may be the first reference adapter because it has
a documented continuation path, but the shared UI, context builder, broker,
tests, and artifact rules must not branch on Codex.

Use a transport-neutral conformance fixture to test the contract, then prove
it with Codex and at least one non-Codex authoring agent before describing
origin routing as generally supported. Do not add in-product multi-agent
selection, arbitrary MCP discovery, or untrusted remote agent URLs: the route
is registered by the authoring integration that actually created or opened the
tour.

## Delivery slices

### 0. Agent-neutral route and text-only Codex spike

- Define the narrow route contract and a fake-agent conformance fixture before
  adding agent-specific code.
- Launch or connect to Codex as a local MCP server in a development fixture.
- Register a thread ID outside the tour artifact and issue one `codex-reply`
  request with a bounded current-step context packet.
- Verify workspace matching, cancellation, stale-thread handling, and what
  occurs when the resumed thread requests a tool or approval.
- Decide whether direct continuation can enforce the read-only contract. If it
  cannot, stop and choose explicit agent-client handoff or a new read-only
  helper before designing voice UI.

### 1. Non-Codex adapter proof

- Integrate one additional authoring agent through the same local registration
  and route contract, using that agent's supported continuation transport.
- Verify that the presenter, context packet, safety boundary, transcript, and
  no-route behavior require no agent-specific UI branch.
- Record unsupported capabilities honestly rather than emulating continuity
  the agent cannot provide.

### 2. Typed Ask surface

- Add the route badge, context preview, typed question, streamed text answer,
  citations, retry, cancellation, and unavailable states.
- Keep conversation history session-local and bounded.
- Exercise expired routes and portable tours with no route.

### 3. Spoken input

- Add push-to-talk microphone capture with an unmistakable recording state.
- Request OS permission only after a reader gesture and explain denial.
- Transcribe to editable text before submission; do not use passive or
  always-listening capture.
- Discard raw audio after transcription unless the reader explicitly chooses
  to save it for diagnostics.

### 4. Spoken answers

- Reuse the TTS playback engine for answer text without coupling answer
  generation to tour auto-advance.
- Interrupt answer audio when the reader asks another question or navigates.
- Preserve the full text answer and its grounding while audio plays.

### 5. Evaluate broader routing

Only after two real adapters are safe and useful, evaluate additional
authoring agents, remote brokers, agent selection, and direct realtime voice.
Each expansion needs its own authentication, authority, capability, and
portability story while preserving the shared route contract.

## Acceptance criteria

- Typed Ask works end to end before microphone support is enabled.
- The UI accurately names the originating agent and whether it is using the
  original conversation, a new helper, or no route; it never implies
  continuity after fallback.
- The shared UI, context builder, broker, and artifact contract contain no
  Codex-only branch and pass the same conformance suite with Codex and at least
  one non-Codex authoring-agent adapter.
- Origin credentials and conversation identifiers remain in the trusted local
  broker and never enter `.bygone`, compiled manifests, renderer logs, or URLs.
- The reader can inspect and edit transcribed text before submission.
- Each request is bounded to explicit tour context and answers retain visible
  text and evidence references.
- Tool calls, approvals, mutations, and external actions cannot be completed
  through the Bygone voice surface.
- A stale, missing, mismatched, or disconnected origin fails closed while the
  tour and TTS remain fully usable.
- Microphone, transcript, and off-device data behavior are disclosed and
  independently controllable from TTS preferences.

## Scope and non-goals

Included in the scoped path:

- a text-first Ask experience grounded in the active tour position;
- an agent-neutral route contract and conformance fixture;
- a local, authenticated Codex reference adapter plus at least one non-Codex
  authoring-agent adapter before general support;
- optional push-to-talk transcription after text routing works;
- spoken rendering of answers through the separate TTS engine; and
- explicit no-route and handoff behavior.

Not included:

- delaying or coupling the TTS release to conversation work;
- embedding live agent credentials or session IDs in tour artifacts;
- voice-driven repository edits, approvals, production writes, or external
  communications;
- passive listening, wake words, meeting capture, or speaker identification;
- presenting a fresh helper as the originating agent;
- arbitrary remote agent endpoints supplied by untrusted tours;
- an in-product provider marketplace, arbitrary agent discovery, or manual
  endpoint entry; or
- direct speech-to-speech realtime sessions in the first implementation.

## Risks and decisions

- **Continuation versus authority:** an original agent conversation may retain
  write and tool permissions. Every adapter must prove a read-only continuation
  boundary or use explicit handoff/new-helper behavior.
- **Capability variance:** agents expose different continuation, streaming,
  cancellation, grounding, and approval semantics. Adapters must declare
  missing capabilities rather than weakening the shared safety contract.
- **Reachability:** a conversation ID is not a transport. Each authoring
  integration must deliberately register a live local route when opening the
  tour.
- **Portability:** live routing is an ephemeral enhancement. Tour playback and
  TTS must never depend on it.
- **Context drift:** the repository or agent conversation may change after tour
  creation. Compare repository identity and range OIDs and label stale context.
- **Privacy:** microphone audio, transcripts, code context, and agent history
  have different disclosure and retention needs. Consent for one does not
  imply consent for the others.
- **Latency:** STT, an existing text agent, and TTS add serial delay. Measure
  before adopting a less inspectable realtime architecture.

## Decision gates

1. Can each resumed agent conversation be constrained to answer-only behavior,
   or must Bygone hand off when a continuation wants tools?
2. What is the minimum continuation/cancellation capability an agent adapter
   must provide to qualify as an originating-agent route?
3. Who registers the origin binding: the tour-generation integration, a local
   agent bridge, or an explicit `bygone present` launch option?
4. Is a new read-only helper valuable enough when the original route is absent,
   or should Ask simply be unavailable?
5. What transcript retention, provider disclosure, and usage-cost policy is
   acceptable for a local open-source application?
6. After the typed prototype, does measured latency justify direct realtime
   speech-to-speech work?

## Next steps

1. Keep this plan out of the TTS implementation milestone.
2. Define the agent-neutral route contract and fake-agent conformance fixture.
3. Build the text-only Codex MCP reference adapter with a synthetic tour and
   repository, then prove the same contract with one non-Codex adapter.
4. Record authority, capability, and stale-conversation behavior before
   changing any public schema or presenter UI.
5. Decide between direct read-only continuation, explicit handoff, and a new
   helper; then scope the typed Ask slice.
