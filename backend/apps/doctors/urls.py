from django.urls import path

from . import views

urlpatterns = [
    path("", views.DoctorListView.as_view()),
    path("me/", views.MyDoctorProfileView.as_view()),
    path("me/availability/", views.MyAvailabilityView.as_view()),
    path("<int:pk>/", views.DoctorDetailView.as_view()),
    path("<int:pk>/slots/", views.DoctorSlotsView.as_view()),
]
