import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';

export function useColors() {
  const dark = useColorScheme() === 'dark';
  return {
    background: dark ? '#000' : '#f2f2f7',
    card: dark ? '#1c1c1e' : '#fff',
    text: dark ? '#fff' : '#000',
    muted: dark ? '#98989f' : '#6c6c70',
    accent: '#0a84ff',
    error: '#ff453a',
    border: dark ? '#38383a' : '#d1d1d6',
  };
}

export function Screen({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      {title ? <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Body({ children, muted, mono }: { children: ReactNode; muted?: boolean; mono?: boolean }) {
  const colors = useColors();
  return <Text selectable style={[styles.body, { color: muted ? colors.muted : colors.text }, mono && styles.mono]}>{children}</Text>;
}

export function Button({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: colors.accent, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function Input(props: { value: string; onChangeText: (text: string) => void; placeholder?: string; multiline?: boolean }) {
  const colors = useColors();
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.muted}
      style={[styles.input, { color: colors.text, borderColor: colors.border }, props.multiline && { minHeight: 80 }]}
    />
  );
}

export function Json({ value }: { value: unknown }) {
  return <Body mono>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</Body>;
}

export function ErrorText({ error }: { error: unknown }) {
  const colors = useColors();
  if (!error) return null;
  const e = error as { code?: string; message?: string; details?: unknown };
  return (
    <Text selectable style={[styles.body, { color: colors.error }]}>
      {e.code ? `${e.code}: ` : ''}
      {e.message ?? String(error)}
      {e.details && Object.keys(e.details as object).length ? `\n${JSON.stringify(e.details, null, 2)}` : ''}
    </Text>
  );
}

/** Runs an async action with loading + error state. */
export function useAction<T>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<T | null>(null);
  const run = async (action: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      setResult(await action());
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };
  return { loading, error, result, run, setResult };
}

export function Loading({ visible }: { visible: boolean }) {
  return visible ? <ActivityIndicator style={{ marginVertical: 8 }} /> : null;
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12, paddingBottom: 48 },
  card: { borderRadius: 12, padding: 16, gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21 },
  mono: { fontFamily: 'Menlo', fontSize: 12, lineHeight: 17 },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, fontSize: 16 },
});
