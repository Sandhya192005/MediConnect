from django.urls import path

from . import views

urlpatterns = [
    path("", views.search),
    path("suggest/", views.suggest),
]
