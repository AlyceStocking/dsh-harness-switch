// Resolve only host-admitted immutable attachments, never caller-supplied paths.
export async function promptParts(blocks, attachments, signal) {
  const parts = [];
  for (const block of blocks) {
    signal?.throwIfAborted();
    if (block.type === 'text') {
      if (block.text.trim()) parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'image') {
      if (!attachments || !block.attachment) throw new Error('Image attachment storage is unavailable');
      const stored = await attachments.readImage(block.attachment, signal);
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(stored.ref.mediaType)) throw new Error('Unsupported image format');
      parts.push({ type: 'image_url', imageUrl: { url: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}` } });
    } else throw new Error('Unsupported prompt content');
  }
  return parts;
}

export async function importWithImages(messages, attachments, signal) {
  const images = [];
  async function visit(blocks) {
    const result = [];
    for (const block of blocks) {
      if (block.type === 'image') {
        images.push(...await promptParts([block], attachments, signal));
        result.push({ type: 'text', text: `[Prior conversation image ${images.length}; supplied visually before the current user message.]` });
      } else if (block.type === 'tool-result' && Array.isArray(block.content)) result.push({ ...block, content: await visit(block.content) });
      else result.push(block);
    }
    return result;
  }
  const history = [];
  for (const message of messages) history.push({ ...message, content: await visit(message.content) });
  return { history, images };
}
