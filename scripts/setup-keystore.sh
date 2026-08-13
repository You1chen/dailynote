#!/bin/bash
# DailyNote 签名密钥生成脚本
# 请在 Android Studio 的 Terminal 中运行此脚本（AS 自带 JDK）
# 或者在任何配置了 JAVA_HOME 的环境中运行

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../android"
KEYSTORE_FILE="$OUTPUT_DIR/daily-note-keystore.jks"
PROPS_FILE="$OUTPUT_DIR/keystore.properties"

# 自动查找 keytool（优先从常见 Android Studio 路径）
if command -v keytool &> /dev/null; then
  KEYTOOL="keytool"
elif [ -f "/d/android studio/jbr/bin/keytool.exe" ]; then
  KEYTOOL="/d/android studio/jbr/bin/keytool.exe"
elif [ -f "/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe" ]; then
  KEYTOOL="/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe"
elif [ -f "/c/Program Files/Android/Android Studio/jbr/bin/keytool" ]; then
  KEYTOOL="/c/Program Files/Android/Android Studio/jbr/bin/keytool"
else
  echo "❌ keytool 未找到"
  echo ""
  echo "请手动指定 keytool 路径，例如："
  echo "  KEYTOOL=\"D:/你的路径/jbr/bin/keytool.exe\" bash setup-keystore.sh"
  exit 1
fi

echo "🔍 使用 keytool: $KEYTOOL"

# 如果 keystore 已存在，询问是否覆盖
if [ -f "$KEYSTORE_FILE" ]; then
  echo "⚠️  密钥文件已存在: $KEYSTORE_FILE"
  read -p "是否覆盖？(y/N): " CONFIRM
  if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "已取消。"
    exit 0
  fi
fi

STOREPASS="dailynote2024"
KEYPASS="dailynote2024"
ALIAS="dailynote"
VALIDITY=10000

echo "🔑 正在生成签名密钥..."
"$KEYTOOL" -genkey -v \
  -keystore "$KEYSTORE_FILE" \
  -keyalg RSA \
  -keysize 2048 \
  -validity $VALIDITY \
  -alias "$ALIAS" \
  -storepass "$STOREPASS" \
  -keypass "$KEYPASS" \
  -dname "CN=DailyNote, OU=Dev, O=DailyNote, L=Shenzhen, ST=Guangdong, C=CN"

echo ""
echo "✅ 密钥已生成: $KEYSTORE_FILE"
echo "   别名 (alias):       $ALIAS"
echo "   有效期:             $((VALIDITY / 365)) 年"
echo ""

# 生成 keystore.properties
cat > "$PROPS_FILE" <<EOF
# DailyNote 签名配置（已自动生成）
# 此文件包含敏感信息，已被 .gitignore 排除
storeFile=daily-note-keystore.jks
storePassword=$STOREPASS
keyAlias=$ALIAS
keyPassword=$KEYPASS
EOF

echo "✅ 签名配置已生成: $PROPS_FILE"
echo ""
echo "===== 下一步 ====="
echo "1. 本地构建: 直接运行 npm run build:android 即可覆盖安装"
echo "2. CI 构建: 需要将密钥上传到 GitHub Secrets（见下方说明）"
echo ""
echo "--- GitHub Actions 配置步骤 ---"
echo "1. 生成密钥的 base64 编码:"
echo "   certutil -encode android/daily-note-keystore.jks tmp.b64 && cat tmp.b64 | grep -v \"^-\" | tr -d '\r\n' > tmp.txt && del tmp.b64"
echo "   或者用 bash: base64 -w0 android/daily-note-keystore.jks"
echo ""
echo "2. 在 GitHub 仓库 → Settings → Secrets and variables → Actions 中添加两个 Secrets:"
echo "   KEYSTORE_BASE64: 第1步生成的 base64 字符串"
echo "   KEYSTORE_PROPERTIES: 下面这行内容"
echo "     storeFile=daily-note-keystore.jks"
echo "     storePassword=$STOREPASS"
echo "     keyAlias=$ALIAS"
echo "     keyPassword=$KEYPASS"
