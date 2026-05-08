import React, { useEffect, useMemo, useState } from "react";
import type { PendingCodexRequest, ToolQuestionAnswer } from "../../../shared/types";
import type { RunAction } from "../rendererTypes";
import {
  customQuestionAnswer,
  defaultQuestionAnswer,
  questionsFromRawRequest,
  requestContextLabel,
  requestKindLabel,
} from "../displayUtils";

export function VoicePendingRequestPanel({
  request,
  requestCount,
  onAction,
}: {
  request: PendingCodexRequest;
  requestCount: number;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
}): React.ReactElement {
  return (
    <section className={`voice-pending-panel ${request.kind}`} aria-label="Pending Codex request">
      <div className="voice-pending-topline">
        <span>{requestKindLabel(request)}</span>
        {requestCount > 1 && <strong>{requestCount} waiting</strong>}
      </div>
      <h2>{request.title}</h2>
      {requestContextLabel(request) && <p>{requestContextLabel(request)}</p>}
      {request.kind === "question" ? (
        <ToolQuestionForm request={request} onAction={onAction} surface="voice" />
      ) : (
        <>
          <RequestDetails request={request} surface="voice" />
          <ApprovalActions request={request} onAction={onAction} surface="voice" />
        </>
      )}
    </section>
  );
}

export function PendingRequestCard({
  request,
  onAction,
}: {
  request: PendingCodexRequest;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
}): React.ReactElement {
  if (request.method === "item/tool/requestUserInput") {
    return <ToolQuestionCard request={request} onAction={onAction} />;
  }

  return (
    <article className={`pending-card ${request.kind}`}>
      <PendingRequestHeader request={request} />
      <RequestDetails request={request} surface="debug" />
      <ApprovalActions request={request} onAction={onAction} surface="debug" />
    </article>
  );
}

function PendingRequestHeader({ request }: { request: PendingCodexRequest }): React.ReactElement {
  return (
    <div className="pending-card-header">
      <div>
        <span className="pending-kind">{requestKindLabel(request)}</span>
        <h3>{request.title}</h3>
        {(request.subtitle || requestContextLabel(request)) && (
          <p>{[request.subtitle, requestContextLabel(request)].filter(Boolean).join(" - ")}</p>
        )}
      </div>
      <code>#{String(request.requestId)}</code>
    </div>
  );
}

function RequestDetails({
  request,
  surface,
}: {
  request: PendingCodexRequest;
  surface: "debug" | "voice";
}): React.ReactElement {
  const details = request.details ?? [];
  return (
    <div className={`request-details ${surface}`}>
      {request.body && <pre>{request.body}</pre>}
      {details.length > 0 && (
        <dl>
          {details.map((detail) => (
            <React.Fragment key={`${detail.label}-${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

function ApprovalActions({
  request,
  onAction,
  surface,
}: {
  request: PendingCodexRequest;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  surface: "debug" | "voice";
}): React.ReactElement {
  const options = request.options ?? ["cancel"];
  return (
    <div className={`button-row wrap approval-actions ${surface}`}>
      {options.includes("accept") && (
        <button className="primary" onClick={() => void onAction(() => window.codexVoice.answerApproval(request.requestId, "accept"))}>
          Accept
        </button>
      )}
      {options.includes("acceptForSession") && (
        <button onClick={() => void onAction(() => window.codexVoice.answerApproval(request.requestId, "acceptForSession"))}>
          Accept Session
        </button>
      )}
      {options.includes("decline") && (
        <button onClick={() => void onAction(() => window.codexVoice.answerApproval(request.requestId, "decline"))}>
          Decline
        </button>
      )}
      {options.includes("cancel") && (
        <button className="danger" onClick={() => void onAction(() => window.codexVoice.answerApproval(request.requestId, "cancel"))}>
          Cancel
        </button>
      )}
    </div>
  );
}

function ToolQuestionCard({
  request,
  onAction,
}: {
  request: PendingCodexRequest;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
}): React.ReactElement {
  return (
    <article className="pending-card question">
      <PendingRequestHeader request={request} />
      <ToolQuestionForm request={request} onAction={onAction} surface="debug" />
    </article>
  );
}

function ToolQuestionForm({
  request,
  onAction,
  surface,
}: {
  request: PendingCodexRequest;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  surface: "debug" | "voice";
}): React.ReactElement {
  const questions = useMemo(() => {
    return request.questions?.length ? request.questions : questionsFromRawRequest(request);
  }, [request]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    setAnswers({});
  }, [request.requestId]);

  const payload: ToolQuestionAnswer[] = questions.map((question) => ({
    questionId: question.id,
    answers: [answers[question.id] || defaultQuestionAnswer(question)].filter(Boolean),
  }));
  const canSubmit = questions.length > 0 && payload.every((answer) => answer.answers.length > 0);

  return (
    <div className={`tool-question-form ${surface}`}>
      {request.body && questions.length === 0 && <p className="question-body">{request.body}</p>}
      {questions.map((question) => (
        <div key={question.id} className="question-block">
          <span>{question.header}</span>
          <label className="stacked-input compact">
            {question.question}
            {question.options?.length ? (
              <div className="question-options">
                {question.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={(answers[question.id] ?? defaultQuestionAnswer(question)) === option.label ? "selected" : ""}
                    onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))}
                  >
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </button>
                ))}
              </div>
            ) : null}
            {question.options?.length && !question.isOther ? null : (
              <input
                value={customQuestionAnswer(question, answers[question.id])}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                placeholder={question.options?.length ? "Other answer" : "Answer"}
                type={question.isSecret ? "password" : "text"}
                aria-label={`${question.header}: ${question.question}`}
              />
            )}
          </label>
        </div>
      ))}
      {questions.length === 0 && <p className="empty">Question details were not included in the app-server payload.</p>}
      <button
        className="primary"
        disabled={!canSubmit}
        onClick={() => void onAction(() => window.codexVoice.answerToolQuestion(request.requestId, payload))}
      >
        Send Answer
      </button>
    </div>
  );
}
