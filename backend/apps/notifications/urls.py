from django.urls import path

from . import views

urlpatterns = [
    path("", views.notification_list),
    path("read-all/", views.mark_all_read),
    path("clear/", views.clear_all),
    path("<int:pk>/", views.delete_one),
    path("<int:pk>/read/", views.mark_read),
]
