<script>
  export let open = false;

  function toggle() {
    open = !open;
  }
</script>

<button class="menu-btn" on:click={toggle} aria-label="Toggle sidebar">
  <span class="bar"></span>
  <span class="bar"></span>
  <span class="bar"></span>
</button>

<aside class:open>
  <div class="sidebar-header">
    <span>ACTIVE SIDEBAR</span>
    <button class="close-btn" on:click={toggle} aria-label="Close sidebar">✕</button>
  </div>
  <nav>
    <a href="/">Home</a>
    <a href="/">About</a>
    <a href="/">Services</a>
    <a href="/">Contact</a>
  </nav>
</aside>

{#if open}
  <div class="overlay" on:click={toggle}></div>
{/if}

<style>
  .menu-btn {
    position: fixed;
    top: 1rem;
    left: 1rem;
    z-index: 300;
    background: #006400;
    border: none;
    border-radius: 4px;
    padding: 8px 10px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .bar {
    display: block;
    width: 22px;
    height: 2px;
    background: white;
    border-radius: 2px;
  }

  aside {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: 240px;
    background: #1a1a1a;
    color: white;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    z-index: 200;
    display: flex;
    flex-direction: column;
  }

  aside.open {
    transform: translateX(0);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.2rem 1rem;
    background: #006400;
    font-weight: bold;
    font-family: sans-serif;
    letter-spacing: 0.05em;
    font-size: 0.85rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: white;
    font-size: 1rem;
    cursor: pointer;
  }

  nav {
    display: flex;
    flex-direction: column;
    padding: 1rem 0;
  }

  nav a {
    padding: 0.75rem 1.5rem;
    color: #ccc;
    text-decoration: none;
    font-family: sans-serif;
    font-size: 0.95rem;
    transition: background 0.2s, color 0.2s;
  }

  nav a:hover {
    background: #2a2a2a;
    color: white;
  }

  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 100;
  }
</style>
