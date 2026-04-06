<script>
  import { chatStore } from './chat.svelte.js';

  let inputText = $state('');
  let messagesEl = $state(null);

  async function handleSend() {
    const text = inputText.trim();
    if (!text || chatStore.loading) return;
    inputText = '';
    await chatStore.send(text);
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  $effect(() => {
    // scroll to bottom whenever messages change
    if (messagesEl && chatStore.messages.length) {
      setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 30);
    }
  });
</script>

<!-- Floating toggle button — bottom-left -->
<button
  onclick={() => chatStore.toggle()}
  class="fixed bottom-4 left-4 z-50 w-11 h-11 rounded-full bg-green-800 text-white shadow-lg flex items-center justify-center hover:bg-green-700 transition-colors"
  title="AI Assistant"
  aria-label="Toggle AI assistant"
>
  <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
</button>

{#if chatStore.open}
  <!-- Chat panel -->
  <div class="fixed bottom-18 left-4 z-50 w-80 flex flex-col rounded-xl shadow-2xl border border-gray-200 bg-white overflow-hidden"
       style="height: 420px;">

    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 bg-green-800 flex-shrink-0">
      <div class="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="text-white font-semibold text-sm">AI Assistant</span>
      </div>
      <div class="flex items-center gap-1">
        {#if chatStore.messages.length > 0}
          <button
            onclick={() => chatStore.clear()}
            class="text-white/70 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
            title="Clear conversation"
          >Clear</button>
        {/if}
        <button
          onclick={() => chatStore.toggle()}
          class="text-white/70 hover:text-white w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          aria-label="Close"
        >✕</button>
      </div>
    </div>

    <!-- Messages -->
    <div bind:this={messagesEl} class="flex-1 overflow-y-auto p-3 space-y-2 text-sm bg-gray-50">
      {#if chatStore.messages.length === 0}
        <p class="text-gray-400 text-center text-xs mt-10 px-4 leading-relaxed">
          Ask me about well-log curves, LAS/DLIS formats, petrophysics, or how to use this app.
        </p>
      {/if}

      {#each chatStore.messages as msg}
        <div class={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
          <div class={msg.role === 'user'
            ? 'bg-green-800 text-white rounded-2xl rounded-br-sm px-3 py-2 max-w-[85%] text-xs leading-relaxed'
            : 'bg-white border border-gray-200 text-gray-800 rounded-2xl rounded-bl-sm px-3 py-2 max-w-[85%] text-xs leading-relaxed shadow-sm'}>
            {msg.content}
          </div>
        </div>
      {/each}

      {#if chatStore.loading}
        <div class="flex justify-start">
          <div class="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm">
            <span class="flex gap-1">
              <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay:0ms"></span>
              <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay:150ms"></span>
              <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay:300ms"></span>
            </span>
          </div>
        </div>
      {/if}

      {#if chatStore.error}
        <div class="text-center text-red-500 text-xs px-2 py-1 bg-red-50 rounded-lg border border-red-200">
          {chatStore.error}
        </div>
      {/if}
    </div>

    <!-- Input -->
    <div class="flex gap-2 p-2 border-t border-gray-200 bg-white flex-shrink-0">
      <textarea
        bind:value={inputText}
        onkeydown={handleKeydown}
        placeholder="Ask about well logs…"
        rows="1"
        class="flex-1 resize-none border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-green-600 leading-relaxed"
        style="max-height: 72px; overflow-y: auto;"
      ></textarea>
      <button
        onclick={handleSend}
        disabled={chatStore.loading || !inputText.trim()}
        class="bg-green-800 text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-green-700 transition-colors flex-shrink-0"
      >Send</button>
    </div>
  </div>
{/if}
