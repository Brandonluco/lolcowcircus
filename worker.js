export default {
  async fetch(request, env) {
    return new Response("CowTube Worker is running!");
  }
};