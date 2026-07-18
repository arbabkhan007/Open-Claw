package ai.openclaw.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.wear.compose.material3.AppScaffold

internal const val EXTRA_WEAR_SCREENSHOT_SCENE = "openclaw.screenshotScene"

internal enum class WearScreenshotScene(
  val rawValue: String,
  val initialPage: WearAppPage,
) {
  Chat("chat", WearAppPage.Chat),
  Voice("voice", WearAppPage.Voice),
  Agents("agents", WearAppPage.Agents),
  Sessions("sessions", WearAppPage.Sessions),
  Controls("controls", WearAppPage.Controls),
  ;

  companion object {
    fun fromRawValue(raw: String?): WearScreenshotScene = entries.firstOrNull { scene -> scene.rawValue == raw?.trim()?.lowercase() } ?: Chat
  }
}

internal object WearScreenshotFixture {
  val snapshot =
    WearConversationSnapshot(
      gatewayState = WearGatewayState.CONNECTED,
      activeAgentId = "main",
      agents =
        listOf(
          WearAgentSummary(id = "main", name = "Main", emoji = "🦞", selected = true),
          WearAgentSummary(id = "research", name = "Research", emoji = "🔎", selected = false),
        ),
      agentControlsSupported = true,
      gatewayControlsSupported = true,
      activeSessionId = "agent:main:release-readiness",
      sessions =
        listOf(
          WearSessionSummary(
            id = "agent:main:release-readiness",
            title = "Release readiness",
            updatedAtEpochMillis = 1_783_555_200_000,
            selected = true,
          ),
          WearSessionSummary(
            id = "agent:main:daily-briefing",
            title = "Daily briefing",
            updatedAtEpochMillis = 1_783_468_800_000,
            selected = false,
          ),
        ),
      messages =
        listOf(
          WearChatMessage(
            id = "wear-screenshot-user",
            role = "user",
            text = "Is the Android release ready?",
            timestamp = 1_783_555_140_000,
          ),
          WearChatMessage(
            id = "wear-screenshot-assistant",
            role = "assistant",
            text = "Phone and watch checks are green. Ready for review.",
            timestamp = 1_783_555_200_000,
          ),
        ),
      selectedModelRef = "openai/gpt-5.6",
    )
}

class WearScreenshotActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val scene = WearScreenshotScene.fromRawValue(intent.getStringExtra(EXTRA_WEAR_SCREENSHOT_SCENE))
    setContent {
      WearScreenshotApp(scene)
    }
  }
}

@Composable
internal fun WearScreenshotApp(scene: WearScreenshotScene) {
  OpenClawWearTheme(themeMode = WearThemeMode.Dark) {
    AppScaffold {
      OpenClawWearScreens(
        snapshot = WearScreenshotFixture.snapshot,
        failure = null,
        loading = false,
        interaction = WearInteractionState.READY,
        speaking = false,
        realtimeCapturing = false,
        realtimePlaying = false,
        realtimePlaybackFailed = false,
        realtimeThinkingOverride = false,
        actionBusy = false,
        inputEnabled = true,
        canAbort = false,
        themeMode = WearThemeMode.Dark,
        autoSpeak = false,
        notificationsGranted = true,
        initialPage = scene.initialPage,
        onTalk = {},
        onType = {},
        onRealtimeTalk = {},
        onAbort = {},
        onSelectAgent = {},
        onSelectSession = {},
        onRefresh = {},
        onGatewayEnabledChange = {},
        onThemeModeChange = {},
        onAutoSpeakChange = {},
        onRequestNotifications = {},
        onOpenNotificationSettings = {},
        onSpeakLatest = {},
        onStopSpeaking = {},
      )
    }
  }
}
