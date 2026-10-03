package com.technotherm.techno_inspections

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "techno/whatsapp")
            .setMethodCallHandler { call, result ->
                if (call.method != "sendFile") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val path = call.argument<String>("path")
                val phone = call.argument<String>("phone")
                val text = call.argument<String>("text") ?: ""
                if (path.isNullOrEmpty() || phone.isNullOrEmpty()) {
                    result.error("BAD_ARGS", "path and phone are required", null)
                    return@setMethodCallHandler
                }
                try {
                    result.success(sendToWhatsApp(File(path), phone, text))
                } catch (e: WhatsAppMissing) {
                    result.error("NOT_INSTALLED", "WhatsApp is not installed", null)
                } catch (e: Exception) {
                    result.error("FAILED", e.message, null)
                }
            }
    }

    private class WhatsAppMissing : Exception()

    /**
     * فاتورة الـPDF على شات العميل في واتساب على طول — من غير شاشة المشاركة اللي المندوب
     * بيدوّر فيها على العميل بالاسم.
     *
     * `jid` هو اللي بيفتح الشات بتاع الرقم ده بدل قايمة «ابعت لمين». واتساب العادي الأول،
     * ولو مش موجود واتساب بيزنس. الاتنين مش موجودين → خطأ، والشاشة بترجع للمشاركة العادية.
     */
    private fun sendToWhatsApp(file: File, phone: String, text: String): Boolean {
        // provider خاص بالمشاركة — مش بتاع ota_update: ده مساراته files/ota_update بس.
        val uri = FileProvider.getUriForFile(this, "$packageName.share_provider", file)
        for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TEXT, text)
                putExtra("jid", "$phone@s.whatsapp.net")
                clipData = ClipData.newRawUri(file.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                setPackage(pkg)
            }
            try {
                startActivity(intent)
                return true
            } catch (e: ActivityNotFoundException) {
                // الباكدج ده مش متثبت — جرّب اللي بعده.
            }
        }
        throw WhatsAppMissing()
    }
}
