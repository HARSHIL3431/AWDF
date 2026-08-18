import { useState } from 'react';

function Contact() {
  const [message, setMessage] = useState('');
  const [showTip, setShowTip] = useState(false);

  return (
    <section className="contact-card">
      <div>
        <p className="eyebrow">Contact</p>
        <h2>Send a Message</h2>
        <p className="muted">
          The input below is controlled by React state, so the preview and
          character count update in real time.
        </p>
      </div>

      <form className="contact-form" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="message">
          Message
          <input
            id="message"
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Write your message here"
          />
        </label>

        <div className="action-row">
          <button
            type="button"
            className="form-button"
            onClick={() => setShowTip((currentValue) => !currentValue)}
          >
            {showTip ? 'Hide tip' : 'Show tip'}
          </button>
        </div>

        {showTip && (
          <div className="help-box">
            Keep your message short and clear so the live preview is easy to
            review.
          </div>
        )}

        <div className="live-preview">
          <strong>Live preview:</strong>
          <p>{message || 'Start typing to see the text appear here.'}</p>
        </div>

        <div className="count-pill">Character count: {message.length}</div>
      </form>
    </section>
  );
}

export default Contact;