import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { C, SP } from '@/design/tokens';
import { T } from '@/design/typography';

type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: C.bg,
            alignItems: 'center',
            justifyContent: 'center',
            padding: SP['6'],
          }}
        >
          <Text style={[T.h2, { color: C.text, marginBottom: SP['3'] }]}>
            エラーが発生しました
          </Text>
          <Text style={[T.body, { color: C.text2, textAlign: 'center', marginBottom: SP['6'] }]}>
            アプリを再起動してください。
          </Text>
          <TouchableOpacity
            onPress={() => this.setState({ hasError: false, error: null })}
            style={{
              backgroundColor: C.accent,
              paddingHorizontal: SP['6'],
              paddingVertical: SP['3'],
              borderRadius: 12,
            }}
          >
            <Text style={[T.buttonMd, { color: '#fff' }]}>再試行</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}
