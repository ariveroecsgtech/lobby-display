const { app } = require('@azure/functions');
const store = require('../../lib/store');
const { IMAGE, IMAGE_ID } = require('../../lib/announcements');

// GET /api/image/{id} — an uploaded poster image, for the lobby screen. Public; ids are long random strings.
app.http('image', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'image/{id}',
  handler: async (request, context) => {
    const id = String(request.params.id || '');
    if (!IMAGE_ID.test(id)) return { status: 404 };
    try {
      const img = await store.imageGet(id);
      if (!img || !IMAGE.types.includes(img.type)) return { status: 404 };
      return { status: 200, body: img.bytes, headers: { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } };
    } catch (err) {
      context.error('image failed', err);
      return { status: 404 };
    }
  }
});
