fn main() {
    // sqlx::migrate! 在编译时嵌入迁移：新增迁移文件时必须重新编译，否则应用里跑的还是旧的迁移集合
    println!("cargo:rerun-if-changed=migrations");
    tauri_build::build()
}
