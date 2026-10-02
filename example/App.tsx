import { StatusBar } from 'expo-status-bar';
import { useState, type ComponentType } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import {
  AvailabilityScreen,
  ChatScreen,
  DiagnosticsScreen,
  ImageScreen,
  ModelInfoScreen,
  ProfilesScreen,
  StructuredScreen,
  ToolsScreen,
  TranscriptScreen,
} from './src/screens';
import { AUTO_SELF_TEST, SelfTestScreen } from './src/selfTest';
import { Card, Screen, useColors } from './src/ui';

const SCREENS: { title: string; subtitle: string; component: ComponentType }[] = [
  { title: 'Availability', subtitle: 'System, PCC and auto', component: AvailabilityScreen },
  { title: 'Chat', subtitle: 'Streaming with useChat', component: ChatScreen },
  { title: 'Structured Output', subtitle: 'Zod schema, partial streaming', component: StructuredScreen },
  { title: 'Tool Calling', subtitle: 'Parallel JS tools + events', component: ToolsScreen },
  { title: 'Image Understanding', subtitle: 'Images + OCRTool (iOS 27)', component: ImageScreen },
  { title: 'Dynamic Profiles', subtitle: 'Switch persona mid-session (iOS 27)', component: ProfilesScreen },
  { title: 'Transcript', subtitle: 'Persist and restore', component: TranscriptScreen },
  { title: 'Model Information', subtitle: 'Context, languages, tokens', component: ModelInfoScreen },
  { title: 'Diagnostics', subtitle: 'getDiagnostics()', component: DiagnosticsScreen },
  { title: 'Self-Test', subtitle: 'End-to-end checks of every feature', component: SelfTestScreen },
];

export default function App() {
  const [index, setIndex] = useState<number | null>(AUTO_SELF_TEST ? SCREENS.length - 1 : null);
  const colors = useColors();
  const current = index === null ? null : SCREENS[index];
  const Current = current?.component;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style="auto" />
      <View style={[styles.header, { borderColor: colors.border }]}>
        {current ? (
          <Pressable accessibilityRole="button" onPress={() => setIndex(null)} hitSlop={12}>
            <Text style={[styles.back, { color: colors.accent }]}>‹ Home</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.title, { color: colors.text }]}>{current?.title ?? 'Foundation Models Lab'}</Text>
      </View>
      {Current ? (
        <Current />
      ) : (
        <Screen>
          {SCREENS.map((screen, i) => (
            <Pressable key={screen.title} accessibilityRole="button" onPress={() => setIndex(i)}>
              <Card title={screen.title}>
                <Text style={{ color: colors.muted }}>{screen.subtitle}</Text>
              </Card>
            </Pressable>
          ))}
        </Screen>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { fontSize: 17 },
  title: { fontSize: 28, fontWeight: '700' },
});
