class ChatState {
  messages = $state([]);
  open = $state(false);
  loading = $state(false);
  error = $state(null);

  toggle() {
    this.open = !this.open;
  }

  async send(userText) {
    if (!userText.trim() || this.loading) return;

    this.messages = [...this.messages, { role: 'user', content: userText }];
    this.loading = true;
    this.error = null;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.messages })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Error ${res.status}`);
      }

      const data = await res.json();
      this.messages = [...this.messages, { role: 'assistant', content: data.content }];
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  clear() {
    this.messages = [];
    this.error = null;
  }
}

export const chatStore = new ChatState();
