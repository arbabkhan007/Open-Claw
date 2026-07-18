package ai.openclaw.wear

import android.app.Application
import android.content.ComponentName
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class WearScreenshotFixtureTest {
  @Test
  fun mapsEveryStoreSceneToItsCurrentPagerSurface() {
    assertEquals(WearAppPage.entries.indices.toList(), WearAppPage.entries.map(WearAppPage::pagerIndex))
    assertEquals(WearAppPage.Chat, WearScreenshotScene.fromRawValue(" CHAT ").initialPage)
    assertEquals(WearAppPage.Voice, WearScreenshotScene.fromRawValue("voice").initialPage)
    assertEquals(WearAppPage.Agents, WearScreenshotScene.fromRawValue("agents").initialPage)
    assertEquals(WearAppPage.Sessions, WearScreenshotScene.fromRawValue("sessions").initialPage)
    assertEquals(WearAppPage.Controls, WearScreenshotScene.fromRawValue("controls").initialPage)
    assertEquals(WearAppPage.Chat, WearScreenshotScene.fromRawValue("unknown").initialPage)
  }

  @Test
  fun fixtureShowsPhoneRelayedAgentsSessionsAndConversation() {
    val snapshot = WearScreenshotFixture.snapshot

    assertEquals(WearGatewayState.CONNECTED, snapshot.gatewayState)
    assertEquals("main", snapshot.activeAgentId)
    assertEquals(listOf("Main", "Research"), snapshot.agents.map(WearAgentSummary::name))
    assertEquals(
      listOf("Release readiness", "Daily briefing"),
      snapshot.sessions.map(WearSessionSummary::title),
    )
    assertEquals(listOf("user", "assistant"), snapshot.messages.map(WearChatMessage::role))
    assertTrue(snapshot.agentControlsSupported)
    assertTrue(snapshot.gatewayControlsSupported)
  }

  @Suppress("DEPRECATION")
  @Test
  fun debugManifestExportsOnlyTheExplicitScreenshotActivity() {
    val application: Application = RuntimeEnvironment.getApplication()
    val activity =
      application.packageManager.getActivityInfo(
        ComponentName(application, WearScreenshotActivity::class.java),
        0,
      )

    assertTrue(activity.exported)
    assertEquals("${application.packageName}.screenshot", activity.taskAffinity)
  }
}
