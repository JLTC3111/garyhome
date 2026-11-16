// Local QA renderer for the same printable HTML used by the application.
// No network, browser profile, credentials or user interface interaction.
import AppKit
import WebKit
import Foundation

if CommandLine.arguments.count != 3 { fatalError("Usage: render-seo-html-pdf.swift input.html output.pdf") }
let input=URL(fileURLWithPath:CommandLine.arguments[1]),output=URL(fileURLWithPath:CommandLine.arguments[2])
let source=try String(contentsOf:input,encoding:.utf8)
try FileManager.default.createDirectory(at:output.deletingLastPathComponent(),withIntermediateDirectories:true)
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
final class Renderer:NSObject,WKNavigationDelegate {
 let view:WKWebView
 override init(){let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent();config.defaultWebpagePreferences.allowsContentJavaScript=false;view=WKWebView(frame:NSRect(x:0,y:0,width:794,height:1123),configuration:config);super.init();view.navigationDelegate=self}
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
  let info=NSPrintInfo.shared.copy() as! NSPrintInfo
  info.paperSize=NSSize(width:595.28,height:841.89)
  info.topMargin=0;info.bottomMargin=0;info.leftMargin=0;info.rightMargin=0
  info.isHorizontallyCentered=false;info.isVerticallyCentered=false
  info.dictionary()[NSPrintInfo.AttributeKey.jobDisposition]=NSPrintInfo.JobDisposition.save
  info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL]=output
  let operation=webView.printOperation(with:info)
  operation.showsPrintPanel=false;operation.showsProgressPanel=false
  let ok=operation.run()
  if !ok || !FileManager.default.fileExists(atPath:output.path){fputs("PDF generation failed\n",stderr);exit(1)}
  print(output.path);app.terminate(nil)
 }
 func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error){fputs("HTML rendering failed: \(error)\n",stderr);exit(1)}
}
let renderer=Renderer();renderer.view.loadHTMLString(source,baseURL:nil)
DispatchQueue.main.asyncAfter(deadline:.now()+45){fputs("PDF rendering timed out\n",stderr);exit(1)}
app.run()
