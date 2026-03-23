<script>
  import '../app.css';
  import { NavMenu } from '$lib/components/NavMenu';
  import { onMount } from 'svelte';

  onMount(() => {
    const s = document.createElement('script');
    s.src = '/virtual-mouse.js';
    document.body.appendChild(s);
  });
</script>

<NavMenu />
<slot />
