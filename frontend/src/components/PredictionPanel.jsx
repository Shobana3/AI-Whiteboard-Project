import React from 'react';
import './PredictionPanel.css';

export default function PredictionPanel({ prediction, loading }) {
  if (loading) {
    return (
      <div className="pred-panel pred-loading">
        <div className="thinking-anim">
          <div className="thinking-robot">🤖</div>
          <p className="thinking-text">Sparky is thinking...</p>
          <div className="thinking-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  if (!prediction) {
    return (
      <div className="pred-panel pred-empty">
        <div className="empty-robot">🤖</div>
        <h3>Hi! I'm Sparky!</h3>
        <p>Draw something on the whiteboard and click <strong>Analyze with AI</strong> to see my guess!</p>
        <div className="empty-hints">
          <span>🐱 Try a cat</span>
          <span>🏠 Or a house</span>
          <span>☀️ Or a sun!</span>
        </div>
      </div>
    );
  }

  const { result } = prediction;
  const confidence = result.confidence || 0.5;
  const pct = Math.round(confidence * 100);
  const circumference = 2 * Math.PI * 28;
  const strokeDash = (confidence * circumference).toFixed(1);

  return (
    <div className="pred-panel pred-filled fade-up">
      {/* Object + confidence */}
      <div className="pred-hero">
        <div className="pred-ring">
          <svg viewBox="0 0 72 72" width="72" height="72">
            <circle cx="36" cy="36" r="28" fill="none" stroke="#EEF0FF" strokeWidth="6" />
            <circle
              cx="36" cy="36" r="28" fill="none"
              stroke="var(--primary)" strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${strokeDash} ${circumference}`}
              transform="rotate(-90 36 36)"
              style={{ transition: 'stroke-dasharray 0.8s ease' }}
            />
          </svg>
          <div className="pred-ring-text">{pct}%</div>
        </div>
        <div className="pred-hero-info">
          <div className="pred-label">AI detected:</div>
          <div className="pred-object">{result.identified_object || 'Something creative!'}</div>
          {result.ml_detected && result.ml_detected !== result.identified_object && (
            <div className="pred-sub">Vision: {result.ml_detected}</div>
          )}
        </div>
      </div>

      {/* Encouragement */}
      <div className="pred-encourage">
        <span>⭐</span>
        <p>{result.encouragement}</p>
      </div>

      {/* Completion */}
      {result.completion_description && (
        <div className="pred-block">
          <div className="pred-block-label">💡 Completion Idea</div>
          <p>{result.completion_description}</p>
        </div>
      )}

      {/* Fun Fact */}
      {result.fun_fact && (
        <div className="pred-block pred-block--yellow">
          <div className="pred-block-label">🧠 Fun Fact</div>
          <p>{result.fun_fact}</p>
        </div>
      )}

      {/* Steps */}
      {result.drawing_steps?.length > 0 && (
        <div className="pred-block">
          <div className="pred-block-label">📋 Next Steps</div>
          <ol className="steps-list">
            {result.drawing_steps.map((s, i) => (
              <li key={i}><span className="step-num">{i+1}</span>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Colors */}
      {result.color_suggestions?.length > 0 && (
        <div className="pred-block">
          <div className="pred-block-label">🎨 Colors to Try</div>
          <div className="tag-row">
            {result.color_suggestions.map((c, i) => (
              <span key={i} className="tag tag--purple">{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Similar */}
      {result.similar_objects?.length > 0 && (
        <div className="pred-block">
          <div className="pred-block-label">🔍 Also Try Drawing</div>
          <div className="tag-row">
            {result.similar_objects.map((o, i) => (
              <span key={i} className="tag tag--orange">{o}</span>
            ))}
          </div>
        </div>
      )}

      {/* Activity */}
      {result.learning_activity && (
        <div className="pred-block pred-block--green">
          <div className="pred-block-label">🎯 Fun Activity</div>
          <p>{result.learning_activity}</p>
        </div>
      )}
    </div>
  );
}
