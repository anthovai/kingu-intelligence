package expo.modules.kingumobilewebshell

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KinguMobileWebShellModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KinguMobileWebShell")

    View(KinguMobileWebShellView::class) {
      Events("onLoadState", "onBridgeMessage", "onExternalNavigation")

      Prop("generationDirectory") { view: KinguMobileWebShellView, value: String ->
        view.setGenerationDirectory(value)
      }

      Prop("sessionId") { view: KinguMobileWebShellView, value: String ->
        view.setSessionId(value)
      }

      Prop("bridgeEnabled") { view: KinguMobileWebShellView, value: Boolean ->
        view.setBridgeEnabled(value)
      }

      AsyncFunction("postBridgeMessage") { view: KinguMobileWebShellView, json: String ->
        view.postBridgeMessage(json)
      }

      OnViewDidUpdateProps { view: KinguMobileWebShellView ->
        view.propsDidUpdate()
      }

      OnViewDestroys { view: KinguMobileWebShellView ->
        view.destroyWebView()
      }
    }
  }
}
