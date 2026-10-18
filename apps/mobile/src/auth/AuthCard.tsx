import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { CHAT_BACKGROUND } from '@/lib/colors';

/** The shared phone auth screen shell: gradient, safe area, keyboard handling and card. */
export function AuthCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <View className="flex-1">
      <LinearGradient
        colors={CHAT_BACKGROUND}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16,
            }}
            keyboardShouldPersistTaps="handled"
          >
            <View className="w-full max-w-sm rounded-2xl border border-border-strong bg-surface p-6 shadow-xl">
              <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
                {title}
              </Text>
              {children}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
