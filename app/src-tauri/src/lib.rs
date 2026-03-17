mod commands;
mod db;
mod fs;
mod python;

use commands::config::{get_app_config, set_model_source_path, set_export_path, set_hf_source, set_ollama_bin_path, set_lmstudio_api_url, check_lmstudio_api};
use commands::environment::{check_environment, setup_environment, install_uv, check_ollama_status, list_ollama_models, get_ollama_path_info, fix_ollama_models_path, reset_ollama_models_path};
use commands::project::{create_project, delete_project, list_projects};
use commands::training::{start_training, stop_training, open_project_folder, list_adapters, delete_adapter, open_adapter_folder, scan_local_models, open_model_cache, validate_model_path, open_lmstudio_app, check_lmstudio_server};
use commands::files::{import_files, list_project_files, read_file_content, delete_file, clear_project_data};
use commands::dataset::{start_cleaning, generate_dataset, get_dataset_preview, stop_generation, list_dataset_versions, open_dataset_folder, sample_raw_files, preview_clean_segments, import_custom_dataset};
use commands::inference::start_inference;
use commands::export::{export_to_ollama, export_to_gguf, export_to_mlx, verify_export_model, start_mlx_server, stop_mlx_server, get_mlx_server_status, MlxServerState};
use commands::native_notification::{get_native_notification_permission, request_native_notification_permission, send_native_notification};
use commands::storage::{scan_storage_usage, cleanup_project_cache};
use commands::notification_config::{get_notification_config, save_notification_config};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = db::run_migrations();

    tauri::Builder::default()
        .manage(MlxServerState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:courtyard.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            check_environment,
            setup_environment,
            install_uv,
            check_ollama_status,
            list_ollama_models,
            get_ollama_path_info,
            fix_ollama_models_path,
            reset_ollama_models_path,
            create_project,
            list_projects,
            delete_project,
            start_training,
            stop_training,
            import_files,
            list_project_files,
            read_file_content,
            delete_file,
            clear_project_data,
            start_cleaning,
            generate_dataset,
            get_dataset_preview,
            stop_generation,
            list_dataset_versions,
            open_dataset_folder,
            sample_raw_files,
            preview_clean_segments,
            import_custom_dataset,
            open_project_folder,
            list_adapters,
            delete_adapter,
            open_adapter_folder,
            scan_local_models,
            open_model_cache,
            validate_model_path,
            start_inference,
            export_to_ollama,
            export_to_gguf,
            export_to_mlx,
            verify_export_model,
            start_mlx_server,
            stop_mlx_server,
            get_mlx_server_status,
            get_app_config,
            set_model_source_path,
            set_export_path,
            set_hf_source,
            set_ollama_bin_path,
            set_lmstudio_api_url,
            check_lmstudio_api,
            open_lmstudio_app,
            check_lmstudio_server,
            get_native_notification_permission,
            request_native_notification_permission,
            send_native_notification,
            scan_storage_usage,
            cleanup_project_cache,
            get_notification_config,
            save_notification_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
