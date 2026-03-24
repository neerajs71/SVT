<script>
  import '../app.css';
  import { NavMenu } from '$lib/components/NavMenu';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    const s = document.createElement('script');
    s.src = '/virtual-mouse.js';
    document.body.appendChild(s);
  });
</script>

<NavMenu />
<div class="h-full overflow-hidden">
  {@render children()}
</div>
