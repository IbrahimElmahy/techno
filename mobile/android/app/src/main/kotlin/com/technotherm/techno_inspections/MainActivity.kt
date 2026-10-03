package com.technotherm.techno_inspections

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
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

        // التحديث من السيرفر (`lib/services/app_updater.dart`): أندرويد ٨+ مابيثبّتش APK من
        // تطبيق غير لما المستخدم يسمح له بإعداد «السماح من هذا المصدر». بنسأل قبل التنزيل
        // ونفتح الإعداد ده بالظبط، بدل ما المندوب ينزّل ٢٨ ميجا ويتقفل في وشّه.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "techno/installer")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "canInstall" -> result.success(
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                            packageManager.canRequestPackageInstalls()
                        else true
                    )
                    "openInstallSettings" -> {
                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                            result.success(false)
                        } else {
                            try {
                                startActivity(
                                    Intent(
                                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                        Uri.parse("package:$packageName")
                                    )
                                )
                                result.success(true)
                            } catch (e: ActivityNotFoundException) {
                                result.success(false)
                            }
                        }
                    }
                    else -> result.notImplemented()
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
