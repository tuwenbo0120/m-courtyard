mod commands;
mod db;
mod fs;
mod python;

use commands::config::{get_app_config, set_model_source_path, set_export_path, set_hf_source};
use commands::environment::{check_environment, setup_environment, install_uv, check_ollama_status, list_ollama_models};
use commands::project::{create_project, delete_project, list_projects};
use commands::training::{start_training, stop_training, open_project_folder, list_adapters, open_adapter_folder, scan_local_models, open_model_cache, validate_model_path};
use commands::files::{import_files, list_project_files, read_file_content, delete_file};
use commands::dataset::{start_cleaning, generate_dataset, get_dataset_preview, stop_generation, list_dataset_versions, open_dataset_folder};
use commands::inference::start_inference;
use commands::export::export_to_ollama;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = db::run_migrations();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
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
            create_project,
            list_projects,
            delete_project,
            start_training,
            stop_training,
            import_files,
            list_project_files,
            read_file_content,
            delete_file,
            start_cleaning,
            generate_dataset,
            get_dataset_preview,
            stop_generation,
            list_dataset_versions,
            open_dataset_folder,
            open_project_folder,
            list_adapters,
            open_adapter_folder,
            scan_local_models,
            open_model_cache,
            validate_model_path,
            start_inference,
            export_to_ollama,
            get_app_config,
            set_model_source_path,
            set_export_path,
            set_hf_source,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
