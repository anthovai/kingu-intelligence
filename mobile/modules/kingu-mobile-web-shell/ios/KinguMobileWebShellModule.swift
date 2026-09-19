import ExpoModulesCore

public class KinguMobileWebShellModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KinguMobileWebShell")

    View(KinguMobileWebShellView.self) {
      Events("onLoadState", "onBridgeMessage")

      Prop("generationDirectory") { (view: KinguMobileWebShellView, value: String) in
        view.setGenerationDirectory(value)
      }

      Prop("sessionId") { (view: KinguMobileWebShellView, value: String) in
        view.setSessionId(value)
      }

      Prop("bridgeEnabled") { (view: KinguMobileWebShellView, value: Bool) in
        view.setBridgeEnabled(value)
      }

      AsyncFunction("postBridgeMessage") {
        (view: KinguMobileWebShellView, json: String, promise: Promise) in
        try view.postBridgeMessage(json, promise: promise)
      }

      OnViewDidUpdateProps { (view: KinguMobileWebShellView) in
        view.propsDidUpdate()
      }
    }
  }
}
