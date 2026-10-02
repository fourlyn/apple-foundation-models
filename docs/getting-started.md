# Getting started

## 1. Check requirements

| | |
| --- | --- |
| Device | iPhone / iPad that supports Apple Intelligence, running iOS/iPadOS 26+ with Apple Intelligence **enabled** (Settings → Apple Intelligence & Siri). |
| Simulator | Works on macOS hosts with Apple Intelligence enabled. Some assets (e.g. tool calling, Vision tools) may be missing in the Simulator; test those on device. |
| Xcode | 26+. Use Xcode 27 to compile the iOS 27 features. |
| React Native | New Architecture. Expo SDK 55+ development build, or bare React Native with Expo Modules. |

## 2. Install

```sh
npx expo install @fourlyn/apple-foundation-models
npx expo run:ios     # or: eas build --profile development --platform ios
```

Expo Go cannot load custom native code, so use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).
For bare React Native see [react-native.md](./react-native.md).

## 3. Check availability

```tsx
import { useAvailability } from '@fourlyn/apple-foundation-models/react';

function AssistantEntryPoint() {
  const { availability } = useAvailability();
  if (!availability) return null;               // checking
  if (!availability.available) {
    switch (availability.reason) {
      case 'appleIntelligenceNotEnabled': return <Text>Turn on Apple Intelligence in Settings to use this feature.</Text>;
      case 'modelNotReady':               return <Text>The model is downloading. Try again soon.</Text>;
      default:                            return null; // device not eligible / unsupported: hide the feature
    }
  }
  return <Assistant />;
}
```

## 4. First request

```ts
import { createSession } from '@fourlyn/apple-foundation-models';

const session = await createSession({ instructions: 'You are a friendly assistant. Keep answers short.' });
const response = await session.respond('Suggest a name for a cat.');
console.log(response.text);
```

## 5. Stream it

```ts
for await (const chunk of session.stream('Write a haiku about rain')) {
  setText(chunk.text); // full text so far
}
```

## 6. Clean up

```ts
session.dispose();
```

Sessions created with `useSession` / `useChat` are disposed automatically on unmount.

## Next

- Structured data: [structured-generation.md](./structured-generation.md)
- Let the model call your code: [tools.md](./tools.md)
- Everything about errors: [errors.md](./errors.md)
