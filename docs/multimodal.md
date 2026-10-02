# Multimodal prompts (images, iOS 27)

```ts
await session.respond({
  prompt: 'What is in this photo? List the objects.',
  images: [{ uri: 'file:///…/photo.jpg', label: 'photo' }],
});
```

Maps to `Attachment(imageURL:)` with `.label(_:)`, combined with the text via `PromptBuilder`.

| Input | Notes |
| --- | --- |
| `{ uri: 'file://…' }` | **Preferred.** Only the path crosses the bridge; the image is loaded natively. Works with `expo-image-picker` (`asset.uri`), `expo-camera`, `expo-file-system`. |
| `{ uri: '/absolute/path.jpg' }` | Treated as a file path. |
| `{ base64: '…', fileExtension?: 'png' }` | Written to a temporary file natively, then attached. Avoid for large images. |
| Remote `https://` | Rejected (`INVALID_ARGUMENT`). Download first. |

`label` lets the prompt (and tools) refer to a specific image: `"Compare image 'before' with image 'after'"`.

Works with `stream`, `generateObject` and `streamObject` too:

```ts
const receipt = await session.generateObject({
  prompt: { prompt: 'Extract the receipt', images: [{ uri }] },
  schema: z.object({ merchant: z.string(), total: z.number() }),
});
```

## Requirements & errors

- iOS 27 and a model with the `vision` capability (`(await getModelInfo()).capabilities?.vision`).
- iOS 26: `UNSUPPORTED_OS_VERSION`. Unreadable/unsupported image data: `UNSUPPORTED_TRANSCRIPT_CONTENT`.
- Model without vision: `UNSUPPORTED_CAPABILITY` (`details.capability: 'vision'`).

Combine with [`OCRTool` / `BarcodeReaderTool`](./tools.md#native-apple-tools-ios-27) for text and code reading.
