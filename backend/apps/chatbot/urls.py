from django.urls import path

from . import views

urlpatterns = [
    path("", views.chat),
    path("history/", views.history),
]
