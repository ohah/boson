#ifndef BOSON_APP_H
#define BOSON_APP_H

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*BosonFrameCallback)(void *user_data, int id, const char *tag,
                                   const char *text, int x, int y, int width, int height);

void *boson_app_new(const char *source);
int boson_app_dispatch(void *runtime, int id);
int boson_app_layout(void *runtime, int width, int height,
                     BosonFrameCallback callback, void *user_data);
long long boson_app_probe_layout_us(void *runtime, int width, int height);
const char *boson_app_last_error(void *runtime);
long long boson_app_last_snapshot_us(void *runtime);
int boson_app_tree_variant(void);
void boson_app_free(void *runtime);

#ifdef __cplusplus
}
#endif

#endif
