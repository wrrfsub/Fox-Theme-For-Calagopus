use serde::{Deserialize, Serialize};
use shared::extensions::settings::{
    ExtensionSettings, SettingsDeserializeExt, SettingsDeserializer, SettingsSerializeExt,
    SettingsSerializer,
};
use utoipa::ToSchema;

/// The theme editor's config as a JSON string. The frontend owns the shape and
/// validates it before use, so new editor options never need a backend change.
/// `announcement_ctas` is the JSON map of announcement buttons, see `cta.rs`;
/// `presets` the custom presets and user choices, see `presets.rs`; `theme_history`
/// the previously saved themes, see `history.rs`. All are empty on older installs.
#[derive(ToSchema, Serialize, Deserialize, Clone, Default)]
pub struct ExtensionSettingsData {
    pub theme: compact_str::CompactString,
    pub announcement_ctas: compact_str::CompactString,
    pub presets: compact_str::CompactString,
    pub theme_history: compact_str::CompactString,
}

#[async_trait::async_trait]
impl SettingsSerializeExt for ExtensionSettingsData {
    async fn serialize(
        &self,
        serializer: SettingsSerializer,
    ) -> Result<SettingsSerializer, anyhow::Error> {
        Ok(serializer
            .write_raw_setting("theme", self.theme.clone())
            .write_raw_setting("announcement_ctas", self.announcement_ctas.clone())
            .write_raw_setting("presets", self.presets.clone())
            .write_raw_setting("theme_history", self.theme_history.clone()))
    }
}

pub struct ExtensionSettingsDataDeserializer;

#[async_trait::async_trait]
impl SettingsDeserializeExt for ExtensionSettingsDataDeserializer {
    async fn deserialize_boxed(
        &self,
        mut deserializer: SettingsDeserializer<'_>,
    ) -> Result<ExtensionSettings, anyhow::Error> {
        Ok(Box::new(ExtensionSettingsData {
            theme: deserializer.take_raw_setting("theme").unwrap_or_default(),
            announcement_ctas: deserializer
                .take_raw_setting("announcement_ctas")
                .unwrap_or_default(),
            presets: deserializer.take_raw_setting("presets").unwrap_or_default(),
            theme_history: deserializer
                .take_raw_setting("theme_history")
                .unwrap_or_default(),
        }))
    }
}
